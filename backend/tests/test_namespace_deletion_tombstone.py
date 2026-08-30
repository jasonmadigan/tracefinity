"""a namespace whose files outlive their owner must not be claimable.

native deletion removes the account record before the storage directory, so a
failed rmtree, or a process killed between the two, leaves files with no owner.
the reusable `default` namespace makes that a cross-tenant exposure: the store
is empty again, first-run setup reopens, and the next administrator would
inherit the previous owner's files.
"""
import os
import shutil

import pytest
from starlette.testclient import TestClient

import app.api.user_routes as user_routes
from app.config import settings
from app.services import namespace_tombstones
from app.services.account_store import get_account_store
from tests.conftest import set_auth_mode

ADMIN = {"email": "admin@example.com", "password": "correct horse battery"}
SECOND_ADMIN = {"email": "next@example.com", "password": "another long password"}
# valid cuid per auth._USER_ID_RE
PROXY_USER = "cjld2cjxh0000qzrmn831i7rn"
PROXY_SECRET = "test-proxy-secret"


def _canary(storage, namespace, body="private"):
    path = storage / namespace / "uploads" / "canary.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    return path


def _break_rmtree(monkeypatch):
    def fail(path, *args, **kwargs):
        raise OSError("device is busy")

    monkeypatch.setattr(user_routes.shutil, "rmtree", fail)


def test_failed_rmtree_leaves_the_namespace_unclaimable(
    native_client, auth_mode_settings, monkeypatch
):
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    canary = _canary(auth_mode_settings, "default")

    _break_rmtree(monkeypatch)
    with pytest.raises(OSError):
        native_client.delete("/api/users/me")

    # the account went first, so the instance is back at first run with the
    # previous owner's files still on disk
    assert get_account_store().count() == 0
    assert canary.exists()
    assert native_client.get("/api/auth/status").json()["setup_required"] is True

    resp = native_client.post("/api/auth/setup", json=SECOND_ADMIN)
    assert resp.status_code == 409, resp.text
    assert "did not finish" in resp.json()["detail"]
    assert get_account_store().count() == 0
    assert canary.read_text() == "private"


def test_claim_check_covers_a_process_killed_between_the_two_steps(
    native_client, auth_mode_settings
):
    """no in-request compensation runs when the process dies mid-delete.

    reproduce that state directly: the marker and the account removal land,
    then nothing else does. only a claim-time check can catch this.
    """
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    account_id = resp.json()["id"]
    canary = _canary(auth_mode_settings, "default")

    namespace_tombstones.mark("default")
    get_account_store().delete(account_id)

    resp = native_client.post("/api/auth/setup", json=SECOND_ADMIN)
    assert resp.status_code == 409, resp.text
    assert get_account_store().count() == 0
    assert canary.read_text() == "private"


def test_admin_create_cannot_claim_a_namespace_that_outlived_its_owner(
    native_client, auth_mode_settings
):
    """an admin-chosen account id keys storage the same way `default` does"""
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    resp = native_client.post(
        "/api/admin/users",
        json={"id": PROXY_USER, "email": "user@example.com", "password": "a fine password"},
    )
    assert resp.status_code == 200, resp.text
    canary = _canary(auth_mode_settings, PROXY_USER)

    namespace_tombstones.mark(PROXY_USER)
    get_account_store().delete(PROXY_USER)

    resp = native_client.post(
        "/api/admin/users",
        json={"id": PROXY_USER, "email": "other@example.com", "password": "a fine password"},
    )
    assert resp.status_code == 409, resp.text
    assert canary.read_text() == "private"


def test_a_marker_left_by_a_finished_deletion_does_not_block_setup(
    native_client, auth_mode_settings
):
    """rmtree succeeded and the process died before clearing the marker.

    nothing survived, so nothing can be inherited: clear it and carry on
    rather than making an operator unbrick first-run setup by hand.
    """
    shutil.rmtree(auth_mode_settings / "default", ignore_errors=True)
    namespace_tombstones.mark("default")

    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    assert namespace_tombstones.is_marked("default") is False


def test_successful_deletion_clears_the_marker(native_client, auth_mode_settings):
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    _canary(auth_mode_settings, "default")

    assert native_client.delete("/api/users/me").status_code == 204
    assert namespace_tombstones.is_marked("default") is False

    # a clean deletion returns the instance to a claimable first run
    resp = native_client.post("/api/auth/setup", json=SECOND_ADMIN)
    assert resp.status_code == 200, resp.text


def test_refused_deletion_does_not_leave_a_marker_behind(native_client):
    """the last-administrator guard aborts before anything is destroyed"""
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    resp = native_client.post(
        "/api/admin/users", json={"email": "user@example.com", "password": "a fine password"}
    )
    assert resp.status_code == 200, resp.text

    assert native_client.delete("/api/users/me").status_code == 409
    assert namespace_tombstones.is_marked("default") is False


def test_open_mode_deletion_marks_the_default_namespace(auth_mode_settings, monkeypatch):
    """a failed pre-auth deletion must not be inherited at a later mode switch"""
    import app.main as main_mod

    set_auth_mode(monkeypatch, "open")
    canary = _canary(auth_mode_settings, "default")

    real_rmtree = shutil.rmtree
    _break_rmtree(monkeypatch)
    with pytest.raises(OSError):
        TestClient(main_mod.app).delete("/api/users/me")
    assert canary.exists()
    assert namespace_tombstones.is_marked("default") is True

    # the operator switches the same storage volume to native mode later
    monkeypatch.setattr(user_routes.shutil, "rmtree", real_rmtree)
    set_auth_mode(monkeypatch, "native")
    resp = TestClient(main_mod.app).post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 409, resp.text
    assert canary.read_text() == "private"


def test_marker_path_refuses_a_namespace_that_would_escape_storage(auth_mode_settings):
    for bad in ("../elsewhere", "..", "a/b", ""):
        with pytest.raises(ValueError):
            namespace_tombstones.mark(bad)
    assert list(settings.storage_path.parent.glob(".pending-deletion-*")) == []


def test_a_namespace_holding_only_empty_directories_is_claimable(auth_mode_settings):
    """a partial rmtree, or a later request recreating the scaffolding"""
    from app.config import ensure_user_dirs

    ensure_user_dirs(auth_mode_settings / "default")
    namespace_tombstones.mark("default")

    namespace_tombstones.claim("default")
    assert namespace_tombstones.is_marked("default") is False


def test_a_namespace_holding_only_a_directory_symlink_is_refused(auth_mode_settings):
    """following the link would report on a tree that is not this namespace's"""
    elsewhere = auth_mode_settings / "elsewhere"
    (elsewhere / "inner").mkdir(parents=True)
    (elsewhere / "inner" / "canary.txt").write_text("private")
    namespace = auth_mode_settings / "default"
    shutil.rmtree(namespace, ignore_errors=True)
    namespace.mkdir(parents=True)
    (namespace / "link").symlink_to(elsewhere, target_is_directory=True)
    namespace_tombstones.mark("default")

    with pytest.raises(namespace_tombstones.NamespaceDeletionPendingError):
        namespace_tombstones.claim("default")
    assert (elsewhere / "inner" / "canary.txt").read_text() == "private"


def test_a_namespace_that_cannot_be_inspected_is_refused(auth_mode_settings):
    """an unreadable directory could hold anything, and very likely is why
    the rmtree failed in the first place"""
    namespace = auth_mode_settings / "default"
    unreadable = namespace / "uploads"
    unreadable.mkdir(parents=True, exist_ok=True)
    (unreadable / "canary.txt").write_text("private")
    os.chmod(unreadable, 0o000)
    namespace_tombstones.mark("default")
    try:
        with pytest.raises(namespace_tombstones.NamespaceDeletionPendingError):
            namespace_tombstones.claim("default")
    finally:
        os.chmod(unreadable, 0o700)
    assert (unreadable / "canary.txt").read_text() == "private"
