"""a namespace holding one party's files must not be handed to another.

an account opens onto a storage namespace and can read and write everything
under it, so claiming an occupied directory hands over its contents. the two
ways a directory ends up occupied and unowned are covered here: a deletion
that destroyed the account record and then failed to remove the files, which
leaves a marker, and everything else, which does not.
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

    with pytest.raises(namespace_tombstones.NamespaceNotClaimableError):
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
        with pytest.raises(namespace_tombstones.NamespaceNotClaimableError):
            namespace_tombstones.claim("default")
    finally:
        os.chmod(unreadable, 0o700)
    assert (unreadable / "canary.txt").read_text() == "private"


def test_an_unmarked_namespace_holding_files_is_not_claimable(
    native_client, auth_mode_settings
):
    """the marker records that someone got as far as marking, nothing more.

    an account creation interrupted before its record landed, or a restored
    volume whose users.json did not come with it, leaves a namespace full of
    one party's files and no marker at all. claiming it hands a new account
    read and write access to them.
    """
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    canary = _canary(auth_mode_settings, PROXY_USER)
    assert namespace_tombstones.is_marked(PROXY_USER) is False

    resp = native_client.post(
        "/api/admin/users",
        json={"id": PROXY_USER, "email": "user@example.com", "password": "a fine password"},
    )
    assert resp.status_code == 409, resp.text
    assert "already holds files" in resp.json()["detail"]
    assert canary.read_text() == "private"


def test_a_refused_claim_creates_no_account(native_client, auth_mode_settings):
    """the claim runs before the store write, so nothing half-lands"""
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    _canary(auth_mode_settings, PROXY_USER)
    before = get_account_store().count()

    resp = native_client.post(
        "/api/admin/users",
        json={"id": PROXY_USER, "email": "user@example.com", "password": "a fine password"},
    )
    assert resp.status_code == 409, resp.text
    assert get_account_store().count() == before
    assert get_account_store().get(PROXY_USER) is None
    assert get_account_store().get_by_email("user@example.com") is None
    # and the refused email is still free for a later, valid create
    resp = native_client.post(
        "/api/admin/users", json={"email": "user@example.com", "password": "a fine password"}
    )
    assert resp.status_code == 200, resp.text


def test_an_unmarked_empty_namespace_stays_claimable(native_client, auth_mode_settings):
    """the ordinary case: scaffolding with nothing in it is nobody's data"""
    from app.config import ensure_user_dirs

    ensure_user_dirs(auth_mode_settings / PROXY_USER)

    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    resp = native_client.post(
        "/api/admin/users",
        json={"id": PROXY_USER, "email": "user@example.com", "password": "a fine password"},
    )
    assert resp.status_code == 200, resp.text


def test_a_zero_byte_file_counts_as_content(auth_mode_settings):
    """size is not ownership: an empty file is still someone's, and a
    namespace holding one is not the untouched directory it looks like"""
    namespace = auth_mode_settings / PROXY_USER
    (namespace / "uploads").mkdir(parents=True)
    (namespace / "uploads" / ".hidden").touch()

    with pytest.raises(namespace_tombstones.NamespaceNotClaimableError):
        namespace_tombstones.claim(PROXY_USER)


def test_admin_create_can_adopt_a_namespace_on_request(native_client, auth_mode_settings):
    """importing an account from a prior system onto its own storage.

    the refusal is about doing this by accident, so the deliberate form of it
    stays available and says so in the request.
    """
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    canary = _canary(auth_mode_settings, PROXY_USER)

    resp = native_client.post(
        "/api/admin/users",
        json={
            "id": PROXY_USER,
            "email": "user@example.com",
            "password": "a fine password",
            "adopt_existing_storage": True,
        },
    )
    assert resp.status_code == 200, resp.text
    assert canary.read_text() == "private"


def test_adopting_never_overrides_an_unfinished_deletion(native_client, auth_mode_settings):
    """a marker means these files' owner was destroyed, which no import
    intends to inherit; the operator removes the directory instead"""
    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    canary = _canary(auth_mode_settings, PROXY_USER)
    namespace_tombstones.mark(PROXY_USER)

    resp = native_client.post(
        "/api/admin/users",
        json={
            "id": PROXY_USER,
            "email": "user@example.com",
            "password": "a fine password",
            "adopt_existing_storage": True,
        },
    )
    assert resp.status_code == 409, resp.text
    assert "did not finish" in resp.json()["detail"]
    assert canary.read_text() == "private"


def test_first_run_setup_still_claims_pre_auth_data(native_client, auth_mode_settings):
    """the documented upgrade from open mode: the first administrator takes
    over the single-user library in place, and no marker exists to allow it"""
    canary = _canary(auth_mode_settings, "default")
    assert namespace_tombstones.is_marked("default") is False

    resp = native_client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    assert canary.read_text() == "private"
