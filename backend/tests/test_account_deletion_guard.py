"""self-deletion must never strand an instance without an administrator.

first-run setup only opens on an empty account store, so an instance with
accounts but no usable admin has no recovery path inside the product.
"""
import pytest
from starlette.testclient import TestClient

from app.models.accounts import Account
from app.services.account_store import LastAdminError, get_account_store
from tests.test_auth_native import create_user, login, setup_admin


def account(account_id, *, is_admin=False, disabled=False):
    return Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="$scrypt$fake",
        is_admin=is_admin,
        disabled=disabled,
        created_at="2024-01-01T00:00:00+00:00",
        storage_namespace=account_id,
    )


def test_sole_admin_cannot_delete_itself_while_others_remain(native_client, auth_mode_settings):
    setup_admin(native_client)
    create_user(native_client, email="member@example.com", password="member password")

    resp = native_client.delete("/api/users/me")
    assert resp.status_code == 409
    assert "administrator" in resp.json()["detail"]

    # the refusal is total: the admin still exists and still owns its data
    assert native_client.get("/api/auth/me").status_code == 200
    assert (auth_mode_settings / "default").exists()


def test_only_account_may_delete_itself_and_reopens_setup(native_client):
    setup_admin(native_client)
    assert native_client.delete("/api/users/me").status_code == 204
    assert get_account_store().count() == 0

    fresh = TestClient(native_client.app)
    assert fresh.get("/api/auth/status").json()["setup_required"] is True


def test_second_admin_makes_self_deletion_safe(native_client):
    setup_admin(native_client)
    create_user(
        native_client, email="second@example.com", password="second password", is_admin=True
    )
    assert native_client.delete("/api/users/me").status_code == 204

    survivor = TestClient(native_client.app)
    assert login(survivor, "second@example.com", "second password").status_code == 200
    assert survivor.get("/api/admin/users").status_code == 200


def test_non_admin_deletes_itself_freely(native_client):
    setup_admin(native_client)
    create_user(native_client, email="member@example.com", password="member password")

    member = TestClient(native_client.app)
    assert login(member, "member@example.com", "member password").status_code == 200
    assert member.delete("/api/users/me").status_code == 204
    assert get_account_store().count() == 1


def test_store_refuses_when_every_remaining_admin_is_disabled(auth_mode_settings):
    store = get_account_store()
    store.create(account("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_admin=True))
    store.create(account("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", is_admin=True, disabled=True))

    with pytest.raises(LastAdminError):
        store.delete("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert store.count() == 2


def test_store_delete_of_unknown_account_is_a_no_op(auth_mode_settings):
    assert get_account_store().delete("nope") is None
