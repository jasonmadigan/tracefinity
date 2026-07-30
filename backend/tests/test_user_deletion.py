import json

from fastapi.testclient import TestClient

import app.api.routes as routes
import app.main as main_mod
from app.config import ensure_user_dirs, settings
from app.main import app

# valid cuid per auth._USER_ID_RE
USER_ID = "cjld2cjxh0000qzrmn831i7rn"


def _client(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(routes.settings, "storage_path", tmp_path)
    # test_proxy_middleware reloads app.main with a secret; pin auth off
    monkeypatch.setattr(main_mod.settings, "proxy_secret", None)
    routes._store_cache.clear()
    routes._project_store_cache.clear()
    ensure_user_dirs(tmp_path / "default")
    return TestClient(app)


def test_delete_user_evicts_project_store_cache(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
    headers = {"x-user-id": USER_ID}

    resp = client.post("/api/bin-projects", json={"name": "Old drawer"}, headers=headers)
    assert resp.status_code == 200

    resp = client.delete("/api/users/me", headers=headers)
    assert resp.status_code == 204

    assert USER_ID not in routes._store_cache
    assert USER_ID not in routes._project_store_cache


def test_deleted_projects_do_not_resurrect_on_next_write(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch)
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
