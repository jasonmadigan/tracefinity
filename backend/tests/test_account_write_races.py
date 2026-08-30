"""account writes must not revert a change that landed during the request.

every handler holds a copy of the account read earlier in the request.
writing that whole copy back rewrites fields nobody touched, so an admin
disable committing in between is silently undone.
"""
import bcrypt as bcrypt_lib
import pytest
from starlette.testclient import TestClient

from app.auth import AUTH_COOKIE_NAME
from app.models.accounts import Account
from app.services.account_store import get_account_store
from tests.test_auth_native import create_user, login, setup_admin

MEMBER = {"email": "member@example.com", "password": "member password"}
IMPORT_ID = "deadbeef-dead-4bee-8bee-deadbeefdead"


def disable_now(account_id: str):
    """the admin's disable commits while the other request is mid-flight"""

    def disable(live: Account) -> Account:
        live.disabled = True
        return live

    get_account_store().mutate(account_id, disable)


def verify_then_disable(monkeypatch, module, account_id):
    real_verify = module.verify_password

    def patched(password, stored):
        ok = real_verify(password, stored)
        if ok:
            disable_now(account_id)
        return ok

    monkeypatch.setattr(module, "verify_password", patched)


def test_rehash_on_login_does_not_revert_a_concurrent_disable(native_client, monkeypatch):
    import app.api.auth_routes as auth_routes

    setup_admin(native_client)
    resp = native_client.post(
        "/api/admin/users",
        json={
            "email": MEMBER["email"],
            "password_hash": bcrypt_lib.hashpw(
                MEMBER["password"].encode(), bcrypt_lib.gensalt(rounds=4)
            ).decode(),
            "id": IMPORT_ID,
        },
    )
    assert resp.status_code == 200, resp.text
    verify_then_disable(monkeypatch, auth_routes, IMPORT_ID)

    member = TestClient(native_client.app)
    assert login(member, **MEMBER).status_code == 401

    stored = get_account_store().get(IMPORT_ID)
    assert stored.disabled is True
    # the rehash itself still landed; only the untouched fields were spared
    assert stored.password_hash.startswith("$scrypt$")
    # and nothing usable came out of the attempt
    assert member.get("/api/auth/me").status_code == 401


def test_login_without_a_rehash_also_refuses_a_concurrent_disable(native_client, monkeypatch):
    import app.api.auth_routes as auth_routes

    setup_admin(native_client)
    member_account = create_user(native_client, **MEMBER)
    verify_then_disable(monkeypatch, auth_routes, member_account["id"])

    member = TestClient(native_client.app)
    assert login(member, **MEMBER).status_code == 401
    assert get_account_store().get(member_account["id"]).disabled is True
    assert member.get("/api/auth/me").status_code == 401


def test_admin_reset_password_does_not_revert_a_concurrent_disable(native_client, monkeypatch):
    import app.api.admin_routes as admin_routes

    setup_admin(native_client)
    member_account = create_user(native_client, **MEMBER)
    real_hash = admin_routes.hash_password

    def hash_then_disable(password):
        digest = real_hash(password)
        disable_now(member_account["id"])
        return digest

    monkeypatch.setattr(admin_routes, "hash_password", hash_then_disable)

    resp = native_client.post(
        f"/api/admin/users/{member_account['id']}/reset-password",
        json={"password": "issued password"},
    )
    assert resp.status_code == 204
    assert get_account_store().get(member_account["id"]).disabled is True


def test_self_service_password_change_does_not_revert_a_concurrent_disable(
    native_client, monkeypatch
):
    import app.api.auth_routes as auth_routes

    setup_admin(native_client)
    member_account = create_user(native_client, **MEMBER)
    member = TestClient(native_client.app)
    assert login(member, **MEMBER).status_code == 200

    verify_then_disable(monkeypatch, auth_routes, member_account["id"])
    resp = member.post(
        "/api/auth/password",
        json={"current_password": MEMBER["password"], "new_password": "a newer password"},
    )
    assert resp.status_code == 204
    assert get_account_store().get(member_account["id"]).disabled is True


def _enable_two_factor_for_member(app):
    """log the member in, enrol 2FA, and return (secret, backup codes)"""
    from tests.test_auth_two_factor import enable_two_factor

    member = TestClient(app)
    assert login(member, **MEMBER).status_code == 200
    return enable_two_factor(member)


def _pending_token_for_member(app):
    client = TestClient(app)
    body = login(client, **MEMBER).json()
    assert body["pending"] is True
    return client, body["pending_token"]


@pytest.mark.parametrize("factor", ["totp", "backup_code"])
def test_two_factor_login_refuses_a_disable_that_lands_during_verification(
    native_client, monkeypatch, factor
):
    """parity with the password step, which re-reads before issuing a token"""
    import app.api.auth_routes as auth_routes
    from app.services import totp

    setup_admin(native_client)
    member_account = create_user(native_client, **MEMBER)
    secret, codes = _enable_two_factor_for_member(native_client.app)
    member, pending_token = _pending_token_for_member(native_client.app)

    real_verify = auth_routes._verify_second_factor

    def verify_then_disable(account, code):
        ok = real_verify(account, code)
        if ok:
            disable_now(member_account["id"])
        return ok

    monkeypatch.setattr(auth_routes, "_verify_second_factor", verify_then_disable)

    code = codes[0] if factor == "backup_code" else totp.code_for_step(
        secret, totp.current_step() + 1
    )
    resp = member.post(
        "/api/auth/login/2fa", json={"pending_token": pending_token, "code": code}
    )
    assert resp.status_code == 401, resp.text
    assert resp.json()["detail"]["code"] == "pending_login_invalid"
    assert AUTH_COOKIE_NAME not in member.cookies
    assert get_account_store().get(member_account["id"]).disabled is True
    assert member.get("/api/auth/me").status_code == 401
