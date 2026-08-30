"""native mode: first-run setup, login, cookie auth, isolation, deletion."""
import threading

import pytest
from starlette.testclient import TestClient

from app.auth import AUTH_COOKIE_NAME
from app.models.schemas import Session
from app.services.account_store import get_account_store
from app.services.session_store import SessionStore

ADMIN = {"email": "admin@example.com", "password": "correct horse battery"}


def setup_admin(client):
    resp = client.post("/api/auth/setup", json=ADMIN)
    assert resp.status_code == 200, resp.text
    return resp.json()


def create_user(client, email="user@example.com", password="another password", **extra):
    resp = client.post("/api/admin/users", json={"email": email, "password": password, **extra})
    assert resp.status_code == 200, resp.text
    return resp.json()


def login(client, email, password):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def test_status_reports_setup_required_then_authenticated(native_client):
    resp = native_client.get("/api/auth/status")
    assert resp.json() == {"mode": "native", "setup_required": True, "authenticated": False}

    setup_admin(native_client)
    resp = native_client.get("/api/auth/status")
    assert resp.json() == {"mode": "native", "setup_required": False, "authenticated": True}


def test_setup_creates_admin_claiming_default_namespace(native_client, auth_mode_settings):
    # pre-auth single-user data already on disk
    store = SessionStore(auth_mode_settings / "default")
    store.set("s1", Session(id="s1", name="Existing trace"))

    account = setup_admin(native_client)
    assert account["is_admin"] is True

    # the first admin sees the claimed data without any file moving
    resp = native_client.get("/api/sessions")
    assert resp.status_code == 200
    assert [s["id"] for s in resp.json()["sessions"]] == ["s1"]

    stored = get_account_store().get(account["id"])
    assert stored.storage_namespace == "default"


def test_setup_race_loser_gets_409(native_client):
    setup_admin(native_client)
    resp = native_client.post(
        "/api/auth/setup", json={"email": "late@example.com", "password": "whatever pass"}
    )
    assert resp.status_code == 409


def test_setup_race_under_concurrency_creates_exactly_one_admin(native_client):
    results = []

    def attempt(n):
        client = TestClient(native_client.app)
        resp = client.post(
            "/api/auth/setup",
            json={"email": f"admin{n}@example.com", "password": "race password"},
        )
        results.append(resp.status_code)

    threads = [threading.Thread(target=attempt, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results) == [200, 409, 409, 409]
    assert get_account_store().count() == 1


def test_no_default_password_exists(native_client):
    # before setup nothing logs in; there is no shared credential
    resp = login(native_client, "admin@example.com", "admin")
    assert resp.status_code == 401
    resp = login(native_client, "admin", "admin")
    assert resp.status_code == 401


def test_api_fails_closed_without_cookie(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    assert fresh.get("/api/bins").status_code == 401
    assert fresh.get("/api/sessions").status_code == 401
    assert fresh.get("/api/auth/me").status_code == 401


def test_login_sets_cookie_and_authenticates_api(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    resp = login(fresh, ADMIN["email"], ADMIN["password"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending"] is False
    assert body["account"]["email"] == ADMIN["email"]
    set_cookie = resp.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "SameSite=lax" in set_cookie.lower().replace("samesite=lax", "SameSite=lax")
    assert AUTH_COOKIE_NAME in set_cookie
    assert fresh.get("/api/bins").status_code == 200


def test_login_rejects_wrong_password_and_unknown_email(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    assert login(fresh, ADMIN["email"], "wrong password").status_code == 401
    assert login(fresh, "nobody@example.com", ADMIN["password"]).status_code == 401


def test_login_email_is_case_insensitive(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    assert login(fresh, "Admin@Example.COM", ADMIN["password"]).status_code == 200


def test_logout_revokes_token_and_clears_cookie(native_client):
    setup_admin(native_client)
    cookie_value = native_client.cookies[AUTH_COOKIE_NAME]
    resp = native_client.post("/api/auth/logout")
    assert resp.status_code == 204
    # revoked server-side: replaying the old cookie fails
    fresh = TestClient(native_client.app)
    fresh.cookies.set(AUTH_COOKIE_NAME, cookie_value)
    assert fresh.get("/api/auth/me").status_code == 401


def test_x_user_id_header_is_rejected_in_native_mode(native_client):
    setup_admin(native_client)
    resp = native_client.get(
        "/api/bins", headers={"x-user-id": "cjld2cjxh0000qzrmn831i7rn"}
    )
    assert resp.status_code == 403


def test_client_cannot_select_another_workspace(native_client):
    setup_admin(native_client)
    other = create_user(native_client)
    other_client = TestClient(native_client.app)
    assert login(other_client, other["email"], "another password").status_code == 200

    # each account writes into its own namespace
    resp = other_client.post("/api/bin-projects", json={"name": "Mine"})
    assert resp.status_code == 200
    admin_projects = native_client.get("/api/bin-projects").json()["projects"]
    other_projects = other_client.get("/api/bin-projects").json()["projects"]
    assert admin_projects == []
    assert len(other_projects) == 1


def test_new_accounts_get_uuid_namespace(native_client, auth_mode_settings):
    setup_admin(native_client)
    other = create_user(native_client)
    stored = get_account_store().get(other["id"])
    assert stored.storage_namespace == other["id"]
    assert len(other["id"]) == 36  # uuid4 satisfies the existing id contract
    other_client = TestClient(native_client.app)
    login(other_client, other["email"], "another password")
    other_client.post("/api/bin-projects", json={"name": "Mine"})
    assert (auth_mode_settings / other["id"] / "bin-projects.json").exists()


def test_storage_requires_cookie_in_native_mode(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    assert fresh.get("/storage/default/uploads/x.png").status_code == 401


def test_storage_allows_own_namespace_only(native_client):
    setup_admin(native_client)
    # admitted past auth: unknown file inside the own namespace is a plain 404
    assert native_client.get("/storage/default/uploads/missing.png").status_code == 404
    other = create_user(native_client)
    assert native_client.get(f"/storage/{other['id']}/uploads/x.png").status_code == 403


@pytest.mark.parametrize(
    "path",
    [
        "/storage/%2e%2e/users.json",
        "/storage/default/%2e%2e/%2e%2e/users.json",
        "/storage/%252e%252e/users.json",
        "/storage/default/%252e%252e/%252e%252e/users.json",
        "/storage/default%2f%2e%2e%2f%2e%2e/users.json",
    ],
)
def test_storage_traversal_attempts_blocked(native_client, path):
    setup_admin(native_client)
    resp = native_client.get(path)
    assert resp.status_code in (401, 403), f"{path} -> {resp.status_code}"


def test_disabling_account_revokes_access_immediately(native_client):
    setup_admin(native_client)
    other = create_user(native_client)
    other_client = TestClient(native_client.app)
    login(other_client, other["email"], "another password")
    assert other_client.get("/api/auth/me").status_code == 200

    resp = native_client.post(f"/api/admin/users/{other['id']}/disable")
    assert resp.status_code == 200
    # existing token is gone, not just future logins
    assert other_client.get("/api/auth/me").status_code == 401
    assert login(TestClient(native_client.app), other["email"], "another password").status_code == 401

    native_client.post(f"/api/admin/users/{other['id']}/enable")
    assert login(TestClient(native_client.app), other["email"], "another password").status_code == 200


def test_admin_cannot_disable_own_account(native_client):
    admin = setup_admin(native_client)
    resp = native_client.post(f"/api/admin/users/{admin['id']}/disable")
    assert resp.status_code == 400


def test_admin_endpoints_require_admin(native_client):
    setup_admin(native_client)
    other = create_user(native_client)
    other_client = TestClient(native_client.app)
    login(other_client, other["email"], "another password")
    assert other_client.get("/api/admin/users").status_code == 403
    assert other_client.post(
        "/api/admin/users", json={"email": "x@example.com", "password": "some password"}
    ).status_code == 403


def test_admin_reset_password_revokes_tokens(native_client):
    setup_admin(native_client)
    other = create_user(native_client)
    other_client = TestClient(native_client.app)
    login(other_client, other["email"], "another password")

    resp = native_client.post(
        f"/api/admin/users/{other['id']}/reset-password", json={"password": "recovered pass"}
    )
    assert resp.status_code == 204
    assert other_client.get("/api/auth/me").status_code == 401
    assert login(TestClient(native_client.app), other["email"], "recovered pass").status_code == 200


def test_self_service_password_change(native_client):
    setup_admin(native_client)
    resp = native_client.post(
        "/api/auth/password",
        json={"current_password": "wrong", "new_password": "new password here"},
    )
    assert resp.status_code == 403
    resp = native_client.post(
        "/api/auth/password",
        json={"current_password": ADMIN["password"], "new_password": "new password here"},
    )
    assert resp.status_code == 204
    # current login survives; the old password does not
    assert native_client.get("/api/auth/me").status_code == 200
    fresh = TestClient(native_client.app)
    assert login(fresh, ADMIN["email"], ADMIN["password"]).status_code == 401
    assert login(fresh, ADMIN["email"], "new password here").status_code == 200


def test_password_change_revokes_other_logins(native_client):
    setup_admin(native_client)
    second_device = TestClient(native_client.app)
    login(second_device, ADMIN["email"], ADMIN["password"])
    assert second_device.get("/api/auth/me").status_code == 200

    native_client.post(
        "/api/auth/password",
        json={"current_password": ADMIN["password"], "new_password": "new password here"},
    )
    assert second_device.get("/api/auth/me").status_code == 401
    assert native_client.get("/api/auth/me").status_code == 200


def test_delete_users_me_removes_account_and_revokes_tokens(native_client, auth_mode_settings):
    admin = setup_admin(native_client)
    native_client.post("/api/bin-projects", json={"name": "Doomed"})
    assert (auth_mode_settings / "default" / "bin-projects.json").exists()

    resp = native_client.delete("/api/users/me")
    assert resp.status_code == 204
    assert not (auth_mode_settings / "default").exists()
    assert get_account_store().get(admin["id"]) is None
    # token revoked and cookie cleared: nothing authenticates any more
    assert native_client.get("/api/auth/me").status_code == 401
    # the instance is back to first-run setup
    status = native_client.get("/api/auth/status").json()
    assert status["setup_required"] is True


def test_setup_validation(native_client):
    assert native_client.post(
        "/api/auth/setup", json={"email": "not-an-email", "password": "long enough pw"}
    ).status_code == 422
    assert native_client.post(
        "/api/auth/setup", json={"email": "a@example.com", "password": "short"}
    ).status_code == 422


def test_admin_create_rejects_invalid_caller_supplied_id(native_client):
    setup_admin(native_client)
    resp = native_client.post(
        "/api/admin/users",
        json={"email": "x@example.com", "password": "some password", "id": "../escape"},
    )
    assert resp.status_code == 422
    resp = native_client.post(
        "/api/admin/users",
        json={"email": "x@example.com", "password": "some password", "id": "UPPERCASE-NOT-VALID-ID-000"},
    )
    assert resp.status_code == 422
    # cuid and uuid forms both satisfy the contract
    create_user(native_client, email="c@example.com", id="cjld2cjxh0000qzrmn831i7rn")
    create_user(native_client, email="u@example.com", id="deadbeef-dead-4bee-8bee-deadbeefdead")


def test_login_rate_limited_per_account(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    for _ in range(10):
        assert login(fresh, ADMIN["email"], "wrong password").status_code == 401
    resp = login(fresh, ADMIN["email"], ADMIN["password"])
    assert resp.status_code == 429
    # another account is unaffected
    assert login(fresh, "someone-else@example.com", "whatever pw").status_code == 401
