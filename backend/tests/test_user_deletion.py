import json
import shutil
import threading

import pytest
from fastapi.testclient import TestClient

import app.api.routes as routes
import app.api.user_routes as user_routes
import app.main as main_mod
from app.config import ensure_user_dirs, settings
from app.main import app
from app.models.schemas import BinModel, BinProject, Session, Tool
from app.services.store_errors import StoreClosedError

# valid cuid per auth._USER_ID_RE
USER_ID = "cjld2cjxh0000qzrmn831i7rn"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # routes imports the same settings object, so one patch covers both
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    # test_proxy_middleware reloads app.main with a secret; pin auth off
    monkeypatch.setattr(main_mod.settings, "proxy_secret", None)
    routes._store_cache.clear()
    routes._project_store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    yield TestClient(app)
    # don't leak this test's user id into later tests
    routes._store_cache.clear()
    routes._project_store_cache.clear()


def test_delete_user_evicts_project_store_cache(client):
    headers = {"x-user-id": USER_ID}

    resp = client.post("/api/bin-projects", json={"name": "Old drawer"}, headers=headers)
    assert resp.status_code == 200

    resp = client.delete("/api/users/me", headers=headers)
    assert resp.status_code == 204

    assert USER_ID not in routes._store_cache
    assert USER_ID not in routes._project_store_cache


def test_deleted_projects_do_not_resurrect_on_next_write(client, tmp_path):
    headers = {"x-user-id": USER_ID}

    resp = client.post("/api/bin-projects", json={"name": "Old drawer"}, headers=headers)
    assert resp.status_code == 200
    old_id = resp.json()["id"]

    resp = client.delete("/api/users/me", headers=headers)
    assert resp.status_code == 204
    assert not (tmp_path / USER_ID).exists()

    resp = client.post("/api/bin-projects", json={"name": "New drawer"}, headers=headers)
    assert resp.status_code == 200
    new_id = resp.json()["id"]

    on_disk = json.loads((tmp_path / USER_ID / "bin-projects.json").read_text())
    assert old_id not in on_disk
    assert new_id in on_disk


def _capture_store(kind: str):
    if kind == "project":
        return routes.get_project_store(USER_ID)
    session_store, tool_store, bin_store = routes.get_stores(USER_ID)
    return {"session": session_store, "tool": tool_store, "bin": bin_store}[kind]


_STORE_CASES = {
    "session": ("sessions.json", lambda: Session(id="s1")),
    "tool": ("tools.json", lambda: Tool(id="t1", name="Old tool", points=[])),
    "bin": ("bins.json", lambda: BinModel(id="b1")),
    "project": ("bin-projects.json", lambda: BinProject(id="p1", name="Old project")),
}


@pytest.mark.parametrize("kind", sorted(_STORE_CASES))
def test_captured_store_write_after_deletion_cannot_recreate_data(client, tmp_path, kind):
    headers = {"x-user-id": USER_ID}
    filename, make_record = _STORE_CASES[kind]

    captured = _capture_store(kind)
    record = make_record()
    captured.set(record.id, record)
    assert (tmp_path / USER_ID / filename).exists()

    resp = client.delete("/api/users/me", headers=headers)
    assert resp.status_code == 204
    assert not (tmp_path / USER_ID).exists()

    # any later request recreates the user dirs; the captured reference
    # must still be unable to write the deleted data back
    routes.get_stores(USER_ID)
    routes.get_project_store(USER_ID)
    assert (tmp_path / USER_ID).exists()

    with pytest.raises(StoreClosedError):
        captured.set(record.id, make_record())

    assert not (tmp_path / USER_ID / filename).exists()


def test_get_stores_during_deletion_waits_for_rmtree_and_sees_empty_state(client, tmp_path, monkeypatch):
    headers = {"x-user-id": USER_ID}

    resp = client.post("/api/bin-projects", json={"name": "Old drawer"}, headers=headers)
    assert resp.status_code == 200
    old_id = resp.json()["id"]

    in_rmtree = threading.Event()
    release_rmtree = threading.Event()
    real_rmtree = shutil.rmtree

    def slow_rmtree(path, *args, **kwargs):
        in_rmtree.set()
        assert release_rmtree.wait(5)
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(user_routes.shutil, "rmtree", slow_rmtree)

    delete_result = {}

    def do_delete():
        delete_result["resp"] = client.delete("/api/users/me", headers=headers)

    deleter = threading.Thread(target=do_delete)
    deleter.start()
    assert in_rmtree.wait(5)

    repopulated = {}

    def do_get():
        repopulated["store"] = routes.get_project_store(USER_ID)

    getter = threading.Thread(target=do_get)
    getter.start()
    getter.join(0.3)
    # store creation must block until deletion finishes, otherwise it
    # loads the about-to-be-deleted files and caches stale data
    assert getter.is_alive()

    release_rmtree.set()
    deleter.join(5)
    getter.join(5)
    assert delete_result["resp"].status_code == 204
    assert repopulated["store"].all() == {}

    new_project = BinProject(id="p-new", name="New drawer")
    repopulated["store"].set(new_project.id, new_project)
    on_disk = json.loads((tmp_path / USER_ID / "bin-projects.json").read_text())
    assert old_id not in on_disk
    assert "p-new" in on_disk
