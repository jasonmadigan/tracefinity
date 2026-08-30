"""two-step 2FA login, enrolment, backup codes, rotation and recovery."""
from starlette.testclient import TestClient

from app.services import secret_box, totp
from app.services.account_store import get_account_store
from app.services.pending_login import pending_logins
from tests.test_auth_native import ADMIN, login, setup_admin


def enable_two_factor(client):
    """enrol and confirm; returns (secret bytes, backup codes)"""
    resp = client.post("/api/auth/2fa/enroll")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    secret = totp.secret_from_base32(body["secret"])
    assert body["otpauth_uri"].startswith("otpauth://totp/")

    # not enabled until a first valid code confirms the authenticator
    status_me = client.get("/api/auth/me").json()
    assert status_me["totp_enabled"] is False

    code = totp.code_for_step(secret, totp.current_step())
    resp = client.post("/api/auth/2fa/confirm", json={"code": code})
    assert resp.status_code == 200, resp.text
    codes = resp.json()["backup_codes"]
    assert len(codes) == 10
    assert client.get("/api/auth/me").json()["totp_enabled"] is True
    return secret, codes


def two_step_login(app, secret, step_offset=1):
    client = TestClient(app)
    resp = login(client, ADMIN["email"], ADMIN["password"])
    assert resp.status_code == 200
    body = resp.json()
    assert body["pending"] is True and body["pending_token"]
    code = totp.code_for_step(secret, totp.current_step() + step_offset)
    resp = client.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": code}
    )
    return client, resp


def test_confirm_rejects_wrong_code_and_stays_disabled(native_client):
    setup_admin(native_client)
    native_client.post("/api/auth/2fa/enroll")
    resp = native_client.post("/api/auth/2fa/confirm", json={"code": "000000"})
    assert resp.status_code == 400
    assert native_client.get("/api/auth/me").json()["totp_enabled"] is False


def test_two_step_login_with_totp(native_client):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    resp = login(fresh, ADMIN["email"], ADMIN["password"])
    body = resp.json()
    assert body["pending"] is True
    # password step issues no auth cookie
    assert fresh.get("/api/auth/me").status_code == 401

    # confirm consumed the current step, so redeem with the next one
    code = totp.code_for_step(secret, totp.current_step() + 1)
    resp = fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": code}
    )
    assert resp.status_code == 200
    assert resp.json()["account"]["email"] == ADMIN["email"]
    assert fresh.get("/api/auth/me").status_code == 200


def test_totp_replay_rejected(native_client):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    client, resp = two_step_login(native_client.app, secret)
    assert resp.status_code == 200
    used_code = totp.code_for_step(secret, totp.current_step() + 1)

    # the same step cannot log in twice
    replay = TestClient(native_client.app)
    body = login(replay, ADMIN["email"], ADMIN["password"]).json()
    resp = replay.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": used_code}
    )
    assert resp.status_code == 401
    assert replay.get("/api/auth/me").status_code == 401


def test_pending_token_is_single_use(native_client):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    token = body["pending_token"]
    code = totp.code_for_step(secret, totp.current_step() + 1)
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": token, "code": code}
    ).status_code == 200
    # redeemed: the same token buys nothing more
    next_code = totp.code_for_step(secret, totp.current_step() + 2)
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": token, "code": next_code}
    ).status_code == 401


def test_pending_token_expires(native_client, monkeypatch):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    real_now = pending_logins._now
    monkeypatch.setattr(pending_logins, "_now", lambda: real_now() + 301)
    code = totp.code_for_step(secret, totp.current_step() + 1)
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": code}
    ).status_code == 401


def test_pending_token_attempts_bounded(native_client):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    token = body["pending_token"]
    for _ in range(5):
        assert fresh.post(
            "/api/auth/login/2fa", json={"pending_token": token, "code": "000000"}
        ).status_code == 401
    # attempts exhausted: even the right code is refused now
    code = totp.code_for_step(secret, totp.current_step() + 1)
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": token, "code": code}
    ).status_code == 401


def test_2fa_failures_count_against_shared_rate_limit(native_client):
    setup_admin(native_client)
    enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    for _ in range(2):
        body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
        for _ in range(5):
            fresh.post(
                "/api/auth/login/2fa",
                json={"pending_token": body["pending_token"], "code": "000000"},
            )
    # ten second-factor failures exhaust the same budget password login uses
    assert login(fresh, ADMIN["email"], ADMIN["password"]).status_code == 429


def test_backup_code_login_is_single_use(native_client):
    setup_admin(native_client)
    _, codes = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    resp = fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": codes[0]}
    )
    assert resp.status_code == 200

    again = TestClient(native_client.app)
    body = login(again, ADMIN["email"], ADMIN["password"]).json()
    resp = again.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": codes[0]}
    )
    assert resp.status_code == 401
    # a different code still works
    body = login(again, ADMIN["email"], ADMIN["password"]).json()
    resp = again.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": codes[1]}
    )
    assert resp.status_code == 200


def test_backup_codes_regenerate_invalidates_old_set(native_client):
    setup_admin(native_client)
    secret, old_codes = enable_two_factor(native_client)

    code = totp.code_for_step(secret, totp.current_step() + 1)
    resp = native_client.post(
        "/api/auth/2fa/backup-codes", json={"password": ADMIN["password"], "code": code}
    )
    assert resp.status_code == 200
    new_codes = resp.json()["backup_codes"]
    assert len(new_codes) == 10
    assert set(new_codes).isdisjoint(old_codes)

    fresh = TestClient(native_client.app)
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": old_codes[0]}
    ).status_code == 401
    body = login(fresh, ADMIN["email"], ADMIN["password"]).json()
    assert fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": new_codes[0]}
    ).status_code == 200


def test_disable_requires_password_and_current_code(native_client):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    code = totp.code_for_step(secret, totp.current_step() + 1)
    assert native_client.post(
        "/api/auth/2fa/disable", json={"password": "wrong", "code": code}
    ).status_code == 403
    assert native_client.post(
        "/api/auth/2fa/disable", json={"password": ADMIN["password"], "code": "000000"}
    ).status_code == 403
    assert native_client.get("/api/auth/me").json()["totp_enabled"] is True

    # the +1 step was never accepted (those attempts failed first), so it
    # is still redeemable
    code = totp.code_for_step(secret, totp.current_step() + 1)
    assert native_client.post(
        "/api/auth/2fa/disable", json={"password": ADMIN["password"], "code": code}
    ).status_code == 204
    assert native_client.get("/api/auth/me").json()["totp_enabled"] is False
    # login is single-step again
    fresh = TestClient(native_client.app)
    assert login(fresh, ADMIN["email"], ADMIN["password"]).json()["pending"] is False


def test_admin_clear_2fa_is_the_recovery_path(native_client):
    setup_admin(native_client)
    admin_store = get_account_store()
    admin_id = admin_store.all()[0].id
    enable_two_factor(native_client)

    resp = native_client.post(f"/api/admin/users/{admin_id}/clear-2fa")
    assert resp.status_code == 204
    fresh = TestClient(native_client.app)
    resp = login(fresh, ADMIN["email"], ADMIN["password"])
    assert resp.json()["pending"] is False
    assert fresh.get("/api/auth/me").status_code == 200


def test_secret_rotation_lazily_reencrypts(native_client, monkeypatch, auth_mode_settings):
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)
    old_token = get_account_store().all()[0].totp_secret
    old_auth_secret = (auth_mode_settings / "auth_secret").read_text().strip()

    from tests.conftest import _auth_settings_objects

    # rotate AUTH_SECRET without AUTH_SECRET_PREVIOUS: decryption fails closed
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, "auth_secret", "rotated-new-secret")
    _, resp = two_step_login(native_client.app, secret, step_offset=1)
    assert resp.status_code == 401

    # with the previous secret supplied, login works and re-encrypts lazily
    # (the +1 step is still fresh: the failed attempt never accepted it)
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, "auth_secret_previous", old_auth_secret)
    _, resp = two_step_login(native_client.app, secret, step_offset=1)
    assert resp.status_code == 200
    rotated = get_account_store().all()[0].totp_secret
    assert rotated != old_token

    # the re-encrypted secret decrypts under the new secret alone
    for s in _auth_settings_objects():
        monkeypatch.setattr(s, "auth_secret_previous", None)
    plaintext, needs_reencrypt = secret_box.decrypt(rotated)
    assert plaintext == secret
    assert not needs_reencrypt


def test_enroll_requires_login(native_client):
    setup_admin(native_client)
    fresh = TestClient(native_client.app)
    assert fresh.post("/api/auth/2fa/enroll").status_code == 401


def test_two_factor_errors_carry_a_machine_readable_code(native_client):
    """clients branch on the code; matching the wording would be brittle"""
    setup_admin(native_client)
    secret, _ = enable_two_factor(native_client)

    fresh = TestClient(native_client.app)
    pending = login(fresh, **ADMIN).json()["pending_token"]

    wrong = fresh.post(
        "/api/auth/login/2fa", json={"pending_token": pending, "code": "000000"}
    )
    assert wrong.status_code == 401
    assert wrong.json()["detail"]["code"] == "two_factor_code_invalid"

    expired = fresh.post(
        "/api/auth/login/2fa", json={"pending_token": "nope", "code": "000000"}
    )
    assert expired.status_code == 401
    assert expired.json()["detail"]["code"] == "pending_login_invalid"

    # the code that was merely wrong left the pending token usable
    good = fresh.post(
        "/api/auth/login/2fa",
        json={
            "pending_token": pending,
            "code": totp.code_for_step(secret, totp.current_step() + 1),
        },
    )
    assert good.status_code == 200
