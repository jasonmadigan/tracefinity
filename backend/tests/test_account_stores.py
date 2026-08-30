"""account and auth token stores: atomicity, uniqueness, expiry, revocation."""
from datetime import datetime, timedelta, timezone

import pytest

from app.models.accounts import Account
from app.services.account_store import AccountStore, DuplicateAccountError
from app.services.auth_token_store import TOKEN_LIFETIME, AuthTokenStore


def make_account(**overrides) -> Account:
    base = dict(
        id="11111111-1111-4111-8111-111111111111",
        email="admin@example.com",
        password_hash="$scrypt$n=16384,r=8,p=1$AAAA$AAAA",
        is_admin=True,
        created_at="2026-01-01T00:00:00+00:00",
        storage_namespace="default",
    )
    base.update(overrides)
    return Account(**base)


def test_create_and_reload_roundtrip(tmp_path):
    store = AccountStore(tmp_path)
    store.create(make_account())
    reloaded = AccountStore(tmp_path)
    account = reloaded.get("11111111-1111-4111-8111-111111111111")
    assert account is not None
    assert account.email == "admin@example.com"
    assert account.storage_namespace == "default"


def test_duplicate_id_and_email_rejected(tmp_path):
    store = AccountStore(tmp_path)
    store.create(make_account())
    with pytest.raises(DuplicateAccountError):
        store.create(make_account(email="other@example.com"))
    with pytest.raises(DuplicateAccountError):
        store.create(make_account(id="22222222-2222-4222-8222-222222222222"))


def test_create_first_admin_race_loser_gets_false(tmp_path):
    store = AccountStore(tmp_path)
    assert store.create_first_admin(make_account())
    assert not store.create_first_admin(
        make_account(id="22222222-2222-4222-8222-222222222222", email="b@example.com")
    )
    assert store.count() == 1


def test_corrupt_users_file_refuses_to_load(tmp_path):
    (tmp_path / "users.json").write_text("{corrupt")
    with pytest.raises(Exception):
        AccountStore(tmp_path)


def test_failed_save_leaves_no_partial_account(tmp_path, monkeypatch):
    store = AccountStore(tmp_path)

    def boom():
        raise OSError("disk full")

    monkeypatch.setattr(store, "_save", boom)
    with pytest.raises(OSError):
        store.create(make_account())
    monkeypatch.undo()
    assert store.count() == 0
    assert store.get("11111111-1111-4111-8111-111111111111") is None


class Clock:
    def __init__(self):
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __call__(self):
        return self.now


def test_token_issue_resolve_and_hashing(tmp_path):
    store = AuthTokenStore(tmp_path)
    raw = store.issue("account-1")
    assert store.resolve(raw) == "account-1"
    assert store.resolve("not-a-token") is None
    # raw token never touches disk
    assert raw not in (tmp_path / "auth_tokens.json").read_text()


def test_token_expiry(tmp_path):
    clock = Clock()
    store = AuthTokenStore(tmp_path, now=clock)
    raw = store.issue("account-1")
    clock.now += TOKEN_LIFETIME + timedelta(seconds=1)
    assert store.resolve(raw) is None


def test_token_lifetime_slides_on_use(tmp_path):
    clock = Clock()
    store = AuthTokenStore(tmp_path, now=clock)
    raw = store.issue("account-1")
    # ten days later the token is used, so it survives past the original expiry
    clock.now += timedelta(days=10)
    assert store.resolve(raw) == "account-1"
    clock.now += timedelta(days=10)
    assert store.resolve(raw) == "account-1"


def test_revoke_for_account_drops_all_tokens(tmp_path):
    store = AuthTokenStore(tmp_path)
    raw_a = store.issue("account-1")
    raw_b = store.issue("account-1")
    raw_other = store.issue("account-2")
    store.revoke_for_account("account-1")
    assert store.resolve(raw_a) is None
    assert store.resolve(raw_b) is None
    assert store.resolve(raw_other) == "account-2"


def test_revoke_for_account_can_keep_current_token(tmp_path):
    store = AuthTokenStore(tmp_path)
    keep = store.issue("account-1")
    other = store.issue("account-1")
    store.revoke_for_account("account-1", keep_raw=keep)
    assert store.resolve(keep) == "account-1"
    assert store.resolve(other) is None


def test_mutate_is_a_compare_and_set(tmp_path):
    store = AccountStore(tmp_path)
    store.create(make_account(totp_last_step=100))
    account_id = "11111111-1111-4111-8111-111111111111"

    def accept_step(step):
        def fn(live):
            if live.totp_last_step is not None and step <= live.totp_last_step:
                return None
            live.totp_last_step = step
            return live
        return fn

    # first redemption wins, the replay loses, later steps still work
    assert store.mutate(account_id, accept_step(101)) is not None
    assert store.mutate(account_id, accept_step(101)) is None
    assert store.mutate(account_id, accept_step(102)) is not None
    assert store.get(account_id).totp_last_step == 102
    assert store.mutate("missing-id", accept_step(103)) is None


def test_mutate_failed_save_restores_previous_record(tmp_path, monkeypatch):
    store = AccountStore(tmp_path)
    store.create(make_account(totp_last_step=100))
    account_id = "11111111-1111-4111-8111-111111111111"

    def boom():
        raise OSError("disk full")

    monkeypatch.setattr(store, "_save", boom)

    def bump(live):
        live.totp_last_step = 200
        return live

    with pytest.raises(OSError):
        store.mutate(account_id, bump)
    monkeypatch.undo()
    assert store.get(account_id).totp_last_step == 100
