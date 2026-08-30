"""admin API tokens: issue, use, revoke, and the boundaries around all three.

these authenticate to the admin surface with no password and no second
factor, so most of what follows checks what they cannot reach.
"""
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from starlette.testclient import TestClient

from app.auth import AUTH_COOKIE_NAME
from app.services.auth_token_store import ADMIN_TOKEN_PREFIX, get_auth_token_store
from tests.conftest import set_auth_mode
from tests.test_auth_native import create_user, login, setup_admin

TOKENS = "/api/admin/tokens"
USERS = "/api/admin/users"


def issue_token(client, **body):
    resp = client.post(TOKENS, json=body or {})
    assert resp.status_code == 200, resp.text
    return resp.json()


def bearer(client, raw):
    """a fresh client carrying only the token: no cookie, no session"""
    fresh = TestClient(client.app)
    fresh.headers["Authorization"] = f"Bearer {raw}"
    return fresh


def admin_with_token(client):
    setup_admin(client)
    issued = issue_token(client)
    return issued, bearer(client, issued["token"])


# --- issuing requires an administrator session ---


def test_issue_requires_authentication(native_client):
    setup_admin(native_client)
    anonymous = TestClient(native_client.app)
    assert anonymous.post(TOKENS, json={}).status_code == 401


def test_issue_refuses_a_non_admin_account(native_client):
    setup_admin(native_client)
    create_user(native_client, email="member@example.com", password="member password")
    member = TestClient(native_client.app)
    assert login(member, "member@example.com", "member password").status_code == 200
    assert member.post(TOKENS, json={}).status_code == 403


def test_issuing_needs_no_body(native_client):
    setup_admin(native_client)
    resp = native_client.post(TOKENS)
    assert resp.status_code == 200, resp.text
    assert resp.json()["label"] == ""


def test_a_token_cannot_issue_another_token(native_client):
    """containment: a leaked token must not be able to mint successors"""
    _, api = admin_with_token(native_client)
    assert api.post(TOKENS, json={}).status_code == 401


def test_a_token_cannot_list_or_revoke_tokens(native_client):
    issued, api = admin_with_token(native_client)
    assert api.get(TOKENS).status_code == 401
    assert api.delete(f"{TOKENS}/{issued['id']}").status_code == 401


# --- the token authenticates to the admin API ---


def test_token_creates_an_account(native_client):
    _, api = admin_with_token(native_client)
    resp = api.post(USERS, json={"email": "new@example.com", "password": "a new password"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["email"] == "new@example.com"


def test_token_resets_a_password(native_client):
    _, api = admin_with_token(native_client)
    created = create_user(native_client, email="reset@example.com", password="old password 1")
    resp = api.post(
        f"{USERS}/{created['id']}/reset-password", json={"password": "brand new password"}
    )
    assert resp.status_code == 204
    fresh = TestClient(native_client.app)
    assert login(fresh, "reset@example.com", "brand new password").status_code == 200


def test_token_lists_disables_and_enables_accounts(native_client):
    _, api = admin_with_token(native_client)
    created = create_user(native_client, email="member@example.com", password="member password")
    assert api.get(USERS).status_code == 200
    assert api.post(f"{USERS}/{created['id']}/disable").status_code == 200
    assert api.post(f"{USERS}/{created['id']}/enable").status_code == 200


def test_token_cannot_clear_two_factor(native_client):
    """it authenticates without a second factor, so it cannot remove one"""
    _, api = admin_with_token(native_client)
    created = create_user(native_client, email="member@example.com", password="member password")
    assert api.post(f"{USERS}/{created['id']}/clear-2fa").status_code == 401
    assert native_client.post(f"{USERS}/{created['id']}/clear-2fa").status_code == 204


def test_token_cannot_read_storage_stats(native_client):
    _, api = admin_with_token(native_client)
    assert api.get("/api/admin/storage-stats").status_code == 401


# --- the token is not a login ---


def test_token_is_rejected_on_the_login_flow(native_client):
    issued, api = admin_with_token(native_client)
    assert api.get("/api/auth/me").status_code == 401
    assert api.post(
        "/api/auth/password",
        json={"current_password": "correct horse battery", "new_password": "another password"},
    ).status_code == 401
    assert api.post("/api/auth/2fa/enroll").status_code == 401


def test_token_is_rejected_on_non_admin_routes(native_client):
    _, api = admin_with_token(native_client)
    assert api.get("/api/sessions").status_code == 401
    assert api.get("/api/tools").status_code == 401
    assert api.delete("/api/users/me").status_code == 401


def test_token_presented_as_the_auth_cookie_does_not_authenticate(native_client):
    issued, _ = admin_with_token(native_client)
    impostor = TestClient(native_client.app)
    impostor.cookies.set(AUTH_COOKIE_NAME, issued["token"])
    assert impostor.get("/api/auth/me").status_code == 401
    assert impostor.get(USERS).status_code == 401


def test_login_cookie_presented_as_a_bearer_token_does_not_authenticate(native_client):
    setup_admin(native_client)
    raw_cookie = native_client.cookies.get(AUTH_COOKIE_NAME)
    assert raw_cookie
    assert bearer(native_client, raw_cookie).get(USERS).status_code == 401


def test_an_invalid_bearer_never_falls_back_to_the_cookie(native_client):
    """an explicit credential that fails is a refusal, not a fall-through"""
    setup_admin(native_client)
    native_client.headers["Authorization"] = "Bearer not-a-real-token"
    try:
        assert native_client.get(USERS).status_code == 401
    finally:
        del native_client.headers["Authorization"]


def test_a_non_bearer_authorization_header_leaves_the_session_alone(native_client):
    """a proxy's own basic auth must not lock an operator out of their session"""
    setup_admin(native_client)
    native_client.headers["Authorization"] = "Basic Zm9vOmJhcg=="
    try:
        assert native_client.get(USERS).status_code == 200
    finally:
        del native_client.headers["Authorization"]


# --- revocation ---


def test_revocation_takes_effect_immediately(native_client):
    issued, api = admin_with_token(native_client)
    assert api.get(USERS).status_code == 200
    assert native_client.delete(f"{TOKENS}/{issued['id']}").status_code == 204
    assert api.get(USERS).status_code == 401


def test_revoking_an_unknown_token_is_a_404(native_client):
    setup_admin(native_client)
    assert native_client.delete(f"{TOKENS}/deadbeefdeadbeef").status_code == 404


def test_revoking_a_token_does_not_log_the_issuer_out(native_client):
    issued, _ = admin_with_token(native_client)
    native_client.delete(f"{TOKENS}/{issued['id']}")
    assert native_client.get("/api/auth/me").status_code == 200


def test_logging_out_does_not_revoke_the_token(native_client):
    _, api = admin_with_token(native_client)
    assert native_client.post("/api/auth/logout").status_code == 204
    assert api.get(USERS).status_code == 200


def test_a_password_change_does_not_revoke_the_token(native_client):
    """rotating a password is not a signal that the automation leaked"""
    _, api = admin_with_token(native_client)
    resp = native_client.post(
        "/api/auth/password",
        json={"current_password": "correct horse battery", "new_password": "a longer password"},
    )
    assert resp.status_code == 204
    assert api.get(USERS).status_code == 200


def test_an_admin_password_reset_does_not_revoke_the_target_account_tokens(native_client):
    setup_admin(native_client)
    other = create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    second = TestClient(native_client.app)
    assert login(second, "second@example.com", "second password").status_code == 200
    issued = issue_token(second)
    api = bearer(native_client, issued["token"])

    resp = native_client.post(
        f"{USERS}/{other['id']}/reset-password", json={"password": "reset by the first"}
    )
    assert resp.status_code == 204
    assert api.get(USERS).status_code == 200


def test_deleting_an_account_purges_its_tokens(native_client):
    setup_admin(native_client)
    other = create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    second = TestClient(native_client.app)
    assert login(second, "second@example.com", "second password").status_code == 200
    issued = issue_token(second)
    api = bearer(native_client, issued["token"])

    assert second.delete("/api/users/me").status_code == 204
    assert api.get(USERS).status_code == 401
    stored = json.loads((get_auth_token_store().file_path).read_text())
    assert all(r["account_id"] != other["id"] for r in stored.values())


# --- the token carries no authority its issuer has lost ---


def test_disabling_the_issuing_account_kills_its_tokens(native_client):
    setup_admin(native_client)
    other = create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    second = TestClient(native_client.app)
    assert login(second, "second@example.com", "second password").status_code == 200
    api = bearer(native_client, issue_token(second)["token"])
    assert api.get(USERS).status_code == 200

    assert native_client.post(f"{USERS}/{other['id']}/disable").status_code == 200
    assert api.get(USERS).status_code == 401

    # re-enabling restores it: disable is a suspension, not a revocation
    assert native_client.post(f"{USERS}/{other['id']}/enable").status_code == 200
    assert api.get(USERS).status_code == 200


def test_a_demoted_account_token_stops_working(native_client):
    from app.services.account_store import get_account_store

    issued, api = admin_with_token(native_client)
    assert api.get(USERS).status_code == 200

    def demote(live):
        live.is_admin = False
        return live

    account_id = native_client.get("/api/auth/me").json()["id"]
    create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    get_account_store().mutate(account_id, demote)
    assert api.get(USERS).status_code == 401


# --- storage ---


def test_the_raw_token_is_never_stored(native_client):
    import hashlib

    issued, _ = admin_with_token(native_client)
    raw = issued["token"]
    path = get_auth_token_store().file_path
    contents = path.read_text()
    assert raw not in contents
    assert raw.removeprefix(ADMIN_TOKEN_PREFIX) not in contents
    assert hashlib.sha256(raw.encode()).hexdigest() in contents


def test_the_token_is_returned_once_and_never_again(native_client):
    issued, _ = admin_with_token(native_client)
    listing = native_client.get(TOKENS)
    assert listing.status_code == 200
    assert issued["token"] not in listing.text
    entries = listing.json()["tokens"]
    assert [e["id"] for e in entries] == [issued["id"]]
    assert "token" not in entries[0]


def test_the_token_never_reaches_the_logs(native_client, caplog):
    with caplog.at_level(logging.DEBUG):
        issued, api = admin_with_token(native_client)
        api.post(USERS, json={"email": "logged@example.com", "password": "some password 1"})
        api.get(USERS)
    assert issued["token"] not in caplog.text


def test_an_issued_token_carries_the_recognisable_prefix(native_client):
    issued, _ = admin_with_token(native_client)
    assert issued["token"].startswith(ADMIN_TOKEN_PREFIX)


def test_the_listing_covers_every_administrator(native_client):
    """a leak has to be containable by whoever is holding the incident"""
    setup_admin(native_client)
    mine = issue_token(native_client, label="mine")
    create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    second = TestClient(native_client.app)
    assert login(second, "second@example.com", "second password").status_code == 200
    theirs = issue_token(second, label="theirs")

    ids = {e["id"] for e in native_client.get(TOKENS).json()["tokens"]}
    assert ids == {mine["id"], theirs["id"]}
    assert native_client.delete(f"{TOKENS}/{theirs['id']}").status_code == 204


# --- expiry ---


def test_a_token_expires_when_asked_to(native_client):
    setup_admin(native_client)
    issued = issue_token(native_client, expires_in_days=1)
    assert issued["expires_at"] is not None
    api = bearer(native_client, issued["token"])
    assert api.get(USERS).status_code == 200

    store = get_auth_token_store()
    store._now = lambda: datetime.now(timezone.utc) + timedelta(days=1, minutes=1)
    assert api.get(USERS).status_code == 401


def test_a_token_defaults_to_no_expiry(native_client):
    setup_admin(native_client)
    issued = issue_token(native_client)
    assert issued["expires_at"] is None
    store = get_auth_token_store()
    store._now = lambda: datetime.now(timezone.utc) + timedelta(days=3650)
    assert bearer(native_client, issued["token"]).get(USERS).status_code == 200


def test_using_a_token_does_not_extend_its_expiry(native_client):
    setup_admin(native_client)
    issued = issue_token(native_client, expires_in_days=1)
    api = bearer(native_client, issued["token"])
    store = get_auth_token_store()

    store._now = lambda: datetime.now(timezone.utc) + timedelta(hours=23)
    assert api.get(USERS).status_code == 200
    store._now = lambda: datetime.now(timezone.utc) + timedelta(days=1, minutes=1)
    assert api.get(USERS).status_code == 401


def test_an_expired_token_drops_out_of_the_listing(native_client):
    setup_admin(native_client)
    issue_token(native_client, expires_in_days=1)
    store = get_auth_token_store()
    store._now = lambda: datetime.now(timezone.utc) + timedelta(days=2)
    assert native_client.get(TOKENS).json()["tokens"] == []


@pytest.mark.parametrize("days", [0, -1, 3651])
def test_a_nonsense_expiry_is_refused(native_client, days):
    setup_admin(native_client)
    assert native_client.post(TOKENS, json={"expires_in_days": days}).status_code == 422


def test_use_is_recorded(native_client):
    issued, api = admin_with_token(native_client)
    assert native_client.get(TOKENS).json()["tokens"][0]["last_used_at"] is None
    assert api.get(USERS).status_code == 200
    assert native_client.get(TOKENS).json()["tokens"][0]["last_used_at"] is not None


# --- comparison ---


def test_the_stored_hash_is_compared_in_constant_time(native_client, monkeypatch):
    import app.services.auth_token_store as store_mod

    issued, api = admin_with_token(native_client)
    real = hmac.compare_digest
    calls = []

    def counting(a, b):
        calls.append((a, b))
        return real(a, b)

    monkeypatch.setattr(store_mod.hmac, "compare_digest", counting)
    assert api.get(USERS).status_code == 200
    assert calls, "resolving an admin token must compare hashes with hmac.compare_digest"


def test_a_near_miss_token_is_refused(native_client):
    issued, _ = admin_with_token(native_client)
    raw = issued["token"]
    mangled = raw[:-1] + ("A" if raw[-1] != "A" else "B")
    assert bearer(native_client, mangled).get(USERS).status_code == 401


# --- other modes ---


@pytest.mark.parametrize("mode,secret", [("open", None), ("proxy", "proxy-secret")])
def test_tokens_do_not_exist_outside_native_mode(native_client, monkeypatch, mode, secret):
    issued, _ = admin_with_token(native_client)
    set_auth_mode(monkeypatch, mode, secret)

    api = bearer(native_client, issued["token"])
    assert api.post(TOKENS, json={}).status_code == 404
    assert api.get(TOKENS).status_code == 404
    assert api.get(USERS).status_code == 404
    assert api.post(USERS, json={"email": "x@example.com", "password": "a password"}).status_code == 404
    # the proxy secret is a transport check, not a principal: it opens nothing here
    api.headers["X-Proxy-Secret"] = secret or ""
    assert api.get(USERS).status_code == 404


# --- attribution ---


def _lines(caplog, needle):
    return [r.getMessage() for r in caplog.records if needle in r.getMessage()]


def test_session_mutations_record_the_acting_administrator(native_client, caplog):
    with caplog.at_level(logging.INFO):
        admin = setup_admin(native_client)
        created = create_user(native_client, email="member@example.com", password="member password")
        native_client.post(f"{USERS}/{created['id']}/disable")
        native_client.post(f"{USERS}/{created['id']}/enable")
        native_client.post(f"{USERS}/{created['id']}/reset-password", json={"password": "reset password"})
        native_client.post(f"{USERS}/{created['id']}/clear-2fa")

    for verb in ("created account", "disabled account", "enabled account",
                 "reset the password for account", "cleared 2FA on account"):
        matching = _lines(caplog, verb)
        assert matching, f"no log line for {verb}"
        assert all(admin["id"] in line and created["id"] in line for line in matching), matching
        assert all("via token" not in line for line in matching), matching


def test_token_mutations_name_the_token(native_client, caplog):
    admin = setup_admin(native_client)
    issued = issue_token(native_client)
    api = bearer(native_client, issued["token"])
    with caplog.at_level(logging.INFO):
        resp = api.post(USERS, json={"email": "member@example.com", "password": "member password"})
        created = resp.json()
        api.post(f"{USERS}/{created['id']}/disable")

    for verb in ("created account", "disabled account"):
        matching = _lines(caplog, verb)
        assert matching, f"no log line for {verb}"
        assert all(f"{admin['id']} via token {issued['id']}" in line for line in matching), matching


def test_issue_and_revoke_are_recorded(native_client, caplog):
    with caplog.at_level(logging.INFO):
        admin = setup_admin(native_client)
        issued = issue_token(native_client, label="provisioner")
        native_client.delete(f"{TOKENS}/{issued['id']}")

    assert _lines(caplog, f"admin {admin['id']} issued admin token {issued['id']}")
    assert _lines(caplog, f"admin {admin['id']} revoked admin token {issued['id']}")


# --- a token cannot reach administrator authority ---
#
# a token authenticates with no password step and no second factor. every
# test here covers a route by which the holder of one could obtain a session,
# a successor credential, or control of an account carrying more authority
# than the token itself.


def test_token_cannot_create_an_administrator(native_client):
    """the whole containment model rests on this: an administrator the token
    minted is one it can then log in as, interactively, with everything"""
    _, api = admin_with_token(native_client)
    resp = api.post(
        USERS,
        json={"email": "escalated@example.com", "password": "a long enough password",
              "is_admin": True},
    )
    assert resp.status_code == 403, resp.text
    # refused, not quietly downgraded to a member account
    emails = [u["email"] for u in native_client.get(USERS).json()["users"]]
    assert "escalated@example.com" not in emails


def test_token_still_creates_ordinary_accounts(native_client):
    """the refusal is about the administrator bit, not about creating"""
    _, api = admin_with_token(native_client)
    resp = api.post(USERS, json={"email": "member@example.com", "password": "member password",
                                 "is_admin": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_admin"] is False


def test_token_cannot_reset_an_administrator_password(native_client):
    """reset it and the holder logs in as that administrator interactively"""
    _, api = admin_with_token(native_client)
    other = create_user(native_client, email="second@example.com",
                        password="second password", is_admin=True)

    resp = api.post(f"{USERS}/{other['id']}/reset-password",
                    json={"password": "seized by the token"})
    assert resp.status_code == 403, resp.text

    fresh = TestClient(native_client.app)
    assert login(fresh, "second@example.com", "seized by the token").status_code == 401
    assert login(fresh, "second@example.com", "second password").status_code == 200


def test_token_cannot_reset_the_password_of_its_own_issuer(native_client):
    _, api = admin_with_token(native_client)
    issuer = native_client.get("/api/auth/me").json()
    resp = api.post(f"{USERS}/{issuer['id']}/reset-password",
                    json={"password": "seized by the token"})
    assert resp.status_code == 403, resp.text


def test_token_cannot_disable_an_administrator(native_client):
    """disabling every other administrator locks out the humans who could
    revoke the token"""
    _, api = admin_with_token(native_client)
    other = create_user(native_client, email="second@example.com",
                        password="second password", is_admin=True)

    assert api.post(f"{USERS}/{other['id']}/disable").status_code == 403
    listed = {u["id"]: u for u in native_client.get(USERS).json()["users"]}
    assert listed[other["id"]]["disabled"] is False


def test_token_cannot_enable_an_administrator(native_client):
    """restoring an administrator a human suspended is the same authority in
    the other direction"""
    _, api = admin_with_token(native_client)
    other = create_user(native_client, email="second@example.com",
                        password="second password", is_admin=True)
    assert native_client.post(f"{USERS}/{other['id']}/disable").status_code == 200

    assert api.post(f"{USERS}/{other['id']}/enable").status_code == 403
    listed = {u["id"]: u for u in native_client.get(USERS).json()["users"]}
    assert listed[other["id"]]["disabled"] is True


def test_the_escalation_chain_is_blocked_at_its_first_step(native_client):
    """mint an administrator, log in as it, mint a successor token, strip the
    root administrator's second factor. it stops at the first request.
    """
    _, api = admin_with_token(native_client)
    root = native_client.get("/api/auth/me").json()

    assert api.post(USERS, json={"email": "escalated@example.com",
                                 "password": "a long enough password",
                                 "is_admin": True}).status_code == 403

    session = TestClient(native_client.app)
    assert login(session, "escalated@example.com", "a long enough password").status_code == 401
    assert session.post(TOKENS, json={}).status_code == 401
    assert session.post(f"{USERS}/{root['id']}/clear-2fa").status_code == 401


def test_a_session_administrator_keeps_every_ability(native_client):
    """the refusals are scoped to the credential, not to the operation"""
    setup_admin(native_client)
    other = create_user(native_client, email="second@example.com",
                        password="second password", is_admin=True)
    assert other["is_admin"] is True

    assert native_client.post(f"{USERS}/{other['id']}/reset-password",
                              json={"password": "reset by a session"}).status_code == 204
    assert native_client.post(f"{USERS}/{other['id']}/disable").status_code == 200
    assert native_client.post(f"{USERS}/{other['id']}/enable").status_code == 200
    assert native_client.post(f"{USERS}/{other['id']}/clear-2fa").status_code == 204
    assert native_client.post(TOKENS, json={}).status_code == 200

    second = TestClient(native_client.app)
    assert login(second, "second@example.com", "reset by a session").status_code == 200


# --- the admin router denies by default ---


def test_an_undeclared_route_on_the_admin_router_is_not_anonymous(native_client):
    """the token and session split is declared per route, so the router needs
    a default: a route added later without one must not be open to anyone.
    """
    from fastapi import APIRouter, FastAPI

    import app.api.admin_routes as admin_routes

    assert admin_routes.router.dependencies, "the admin router declares no default dependency"

    probe = APIRouter(dependencies=admin_routes.router.dependencies)

    @probe.get("/admin/undeclared")
    def undeclared():
        return {"reached": True}

    app = FastAPI()
    app.include_router(probe, prefix="/api")
    setup_admin(native_client)

    anonymous = TestClient(app)
    assert anonymous.get("/api/admin/undeclared").status_code == 401

    authed = TestClient(app)
    authed.cookies.update(native_client.cookies)
    assert authed.get("/api/admin/undeclared").status_code == 200
