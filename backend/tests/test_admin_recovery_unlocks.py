"""admin recovery actions must clear the login lockout they are recovering from.

a re-enabled or password-reset account that stays 429 for the rest of the
window is not recovered, only differently locked out.
"""
from starlette.testclient import TestClient

from app.services.login_rate_limit import MAX_FAILURES
from tests.test_auth_native import create_user, login, setup_admin

MEMBER = {"email": "member@example.com", "password": "member password"}


def lock_out(client, email):
    for _ in range(MAX_FAILURES):
        login(client, email, "wrong password")
    assert login(client, email, "wrong password").status_code == 429


def test_enable_clears_the_lockout(native_client):
    setup_admin(native_client)
    member = create_user(native_client, **MEMBER)
    native_client.post(f"/api/admin/users/{member['id']}/disable")

    attacker = TestClient(native_client.app)
    lock_out(attacker, MEMBER["email"])

    assert native_client.post(f"/api/admin/users/{member['id']}/enable").status_code == 200
    assert login(TestClient(native_client.app), **MEMBER).status_code == 200


def test_reset_password_clears_the_lockout(native_client):
    setup_admin(native_client)
    member = create_user(native_client, **MEMBER)

    attacker = TestClient(native_client.app)
    lock_out(attacker, MEMBER["email"])

    resp = native_client.post(
        f"/api/admin/users/{member['id']}/reset-password", json={"password": "issued password"}
    )
    assert resp.status_code == 204
    fresh = TestClient(native_client.app)
    assert login(fresh, MEMBER["email"], "issued password").status_code == 200
