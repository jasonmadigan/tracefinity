"""admin account import: legacy credentials, idempotency, atomicity, rehash."""
import bcrypt as bcrypt_lib
from starlette.testclient import TestClient

from app.services import totp
from app.services.account_store import get_account_store
from app.services.password_hashing import hash_password
from tests.test_auth_native import login, setup_admin

IMPORT_ID = "deadbeef-dead-4bee-8bee-deadbeefdead"


def bcrypt_hash(password: str) -> str:
    return bcrypt_lib.hashpw(password.encode(), bcrypt_lib.gensalt(rounds=4)).decode()


def test_import_bcrypt_credential_verifies_and_rehashes_on_login(native_client):
    setup_admin(native_client)
    resp = native_client.post(
        "/api/admin/users",
        json={
            "email": "legacy@example.com",
            "password_hash": bcrypt_hash("legacy password"),
            "id": IMPORT_ID,
            "created_at": "2024-06-01T00:00:00+00:00",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == IMPORT_ID
    assert body["created_at"] == "2024-06-01T00:00:00+00:00"

    stored = get_account_store().get(IMPORT_ID)
    assert stored.password_hash.startswith("$2")
    assert stored.storage_namespace == IMPORT_ID

    fresh = TestClient(native_client.app)
    assert login(fresh, "legacy@example.com", "wrong").status_code == 401
    assert login(fresh, "legacy@example.com", "legacy password").status_code == 200

    # first successful login rehashed to the native scheme
    stored = get_account_store().get(IMPORT_ID)
    assert stored.password_hash.startswith("$scrypt$")
    # and the password still works against the new hash
    assert login(TestClient(native_client.app), "legacy@example.com", "legacy password").status_code == 200


def test_import_native_scrypt_hash(native_client):
    setup_admin(native_client)
    resp = native_client.post(
        "/api/admin/users",
        json={"email": "scrypt@example.com", "password_hash": hash_password("imported pw")},
    )
    assert resp.status_code == 200
    fresh = TestClient(native_client.app)
    assert login(fresh, "scrypt@example.com", "imported pw").status_code == 200


def test_import_with_totp_secret_enables_two_step_login(native_client):
    setup_admin(native_client)
    secret = totp.generate_secret()
    resp = native_client.post(
        "/api/admin/users",
        json={
            "email": "twofa@example.com",
            "password_hash": bcrypt_hash("their password"),
            "totp_secret": totp.secret_to_base32(secret),
            "backup_code_hashes": [hash_password("aaaaa-bbbbb")],
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["totp_enabled"] is True

    fresh = TestClient(native_client.app)
    body = login(fresh, "twofa@example.com", "their password").json()
    assert body["pending"] is True
    code = totp.code_for_step(secret, totp.current_step())
    resp = fresh.post(
        "/api/auth/login/2fa", json={"pending_token": body["pending_token"], "code": code}
    )
    assert resp.status_code == 200

    # imported backup code hash also redeems
    again = TestClient(native_client.app)
    body = login(again, "twofa@example.com", "their password").json()
    resp = again.post(
        "/api/auth/login/2fa",
        json={"pending_token": body["pending_token"], "code": "aaaaa-bbbbb"},
    )
    assert resp.status_code == 200


def test_import_is_idempotent_and_never_overwrites(native_client):
    setup_admin(native_client)
    first = {
        "email": "import@example.com",
        "password_hash": bcrypt_hash("original password"),
        "id": IMPORT_ID,
    }
    assert native_client.post("/api/admin/users", json=first).status_code == 200
    original_hash = get_account_store().get(IMPORT_ID).password_hash

    # same id and email again, different credential: no-op, nothing overwritten
    repeat = dict(first, password_hash=bcrypt_hash("attacker password"))
    resp = native_client.post("/api/admin/users", json=repeat)
    assert resp.status_code == 200
    assert get_account_store().get(IMPORT_ID).password_hash == original_hash

    # same id with a different email conflicts
    conflict = dict(first, email="other@example.com")
    assert native_client.post("/api/admin/users", json=conflict).status_code == 409

    # same email under a different id conflicts
    conflict = dict(first, id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert native_client.post("/api/admin/users", json=conflict).status_code == 409


def test_import_validation_failures_leave_nothing_behind(native_client):
    setup_admin(native_client)
    before = get_account_store().count()
    bad_requests = [
        # unsupported hash scheme
        {"email": "a@example.com", "password_hash": "$argon2id$v=19$stuff"},
        # both password and password_hash
        {"email": "a@example.com", "password": "some password", "password_hash": bcrypt_hash("x")},
        # neither
        {"email": "a@example.com"},
        # bad totp secret
        {"email": "a@example.com", "password": "some password", "totp_secret": "!!notbase32!!"},
        # bad backup code hash among valid fields
        {
            "email": "a@example.com",
            "password": "some password",
            "backup_code_hashes": [hash_password("ok"), "plaintext-code"],
        },
        # bad created_at
        {"email": "a@example.com", "password": "some password", "created_at": "yesterday"},
        # bad id format
        {"email": "a@example.com", "password": "some password", "id": "short"},
        # bad email
        {"email": "not an email", "password": "some password"},
    ]
    for body in bad_requests:
        resp = native_client.post("/api/admin/users", json=body)
        assert resp.status_code == 422, f"{body} -> {resp.status_code}"
        assert get_account_store().count() == before, f"partial write for {body}"
        assert get_account_store().get_by_email("a@example.com") is None
