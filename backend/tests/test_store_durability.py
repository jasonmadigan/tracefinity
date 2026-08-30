"""credential stores must survive power loss, not only a crash mid-write.

os.replace is atomic, so a crash can never expose a half-written file. it is
not durable: the rename can reach the directory entry while the contents are
still in the page cache, so a power cut can leave an empty or truncated
users.json on an instance that still holds accounts. every assertion here
ties an fsync to the identity of the thing it flushed, so none of them can
pass on a call count alone.
"""
from __future__ import annotations

import errno
import os
import stat
from dataclasses import dataclass
from pathlib import Path

import pytest

from app.config import settings
from app.models.accounts import Account
from app.services import secret_box
from app.services.account_store import AccountStore
from app.services.auth_token_store import AuthTokenStore


@dataclass(frozen=True)
class Flushed:
    st_dev: int
    st_ino: int
    is_dir: bool


def record_fsyncs(monkeypatch) -> list[Flushed]:
    """capture what each os.fsync actually pointed at, by identity"""
    real_fsync = os.fsync
    flushed: list[Flushed] = []

    def spy(fd):
        info = os.fstat(fd)
        flushed.append(Flushed(info.st_dev, info.st_ino, stat.S_ISDIR(info.st_mode)))
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", spy)
    return flushed


def flushed_file(flushed: list[Flushed], path: Path) -> bool:
    """did some fsync land on the inode this path now names?

    the temp file keeps its inode across the rename, so this proves the
    flush hit the bytes that became the live file
    """
    info = os.stat(path)
    return any(
        f.st_dev == info.st_dev and f.st_ino == info.st_ino and not f.is_dir
        for f in flushed
    )


def flushed_directory(flushed: list[Flushed], path: Path) -> bool:
    info = os.stat(path)
    return any(
        f.st_dev == info.st_dev and f.st_ino == info.st_ino and f.is_dir
        for f in flushed
    )


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


def refuse_directory_open(monkeypatch):
    """windows cannot open a directory at all"""
    real_open = os.open

    def guarded(path, flags, *args, **kwargs):
        if isinstance(path, (str, bytes, os.PathLike)) and os.path.isdir(path):
            raise PermissionError(errno.EACCES, "cannot open a directory")
        return real_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", guarded)


def refuse_directory_fsync(monkeypatch):
    """some filesystems open a directory happily then reject the fsync"""
    real_fsync = os.fsync

    def guarded(fd):
        if stat.S_ISDIR(os.fstat(fd).st_mode):
            raise OSError(errno.EINVAL, "fsync unsupported on directories")
        return real_fsync(fd)

    monkeypatch.setattr(os, "fsync", guarded)


def test_account_save_flushes_the_file_that_becomes_users_json(tmp_path, monkeypatch):
    store = AccountStore(tmp_path)
    flushed = record_fsyncs(monkeypatch)
    store.create(make_account())
    assert flushed_file(flushed, tmp_path / "users.json")


def test_account_save_flushes_the_storage_directory(tmp_path, monkeypatch):
    """without this the rename itself is lost and users.json disappears"""
    store = AccountStore(tmp_path)
    flushed = record_fsyncs(monkeypatch)
    store.create(make_account())
    assert flushed_directory(flushed, tmp_path)


def test_every_account_write_path_flushes(tmp_path, monkeypatch):
    store = AccountStore(tmp_path)
    store.create(make_account())
    users = tmp_path / "users.json"

    for change in (
        lambda: store.create(
            make_account(id="22222222-2222-4222-8222-222222222222", email="b@x.com")
        ),
        lambda: store.mutate(
            "22222222-2222-4222-8222-222222222222",
            lambda a: a.model_copy(update={"disabled": True}),
        ),
        lambda: store.delete("22222222-2222-4222-8222-222222222222"),
    ):
        flushed = record_fsyncs(monkeypatch)
        change()
        assert flushed_file(flushed, users)
        assert flushed_directory(flushed, tmp_path)
        monkeypatch.undo()


def test_first_admin_creation_flushes(tmp_path, monkeypatch):
    """the write that ends first-run setup is the one worth keeping"""
    store = AccountStore(tmp_path)
    flushed = record_fsyncs(monkeypatch)
    assert store.create_first_admin(make_account())
    assert flushed_file(flushed, tmp_path / "users.json")
    assert flushed_directory(flushed, tmp_path)


def test_auth_token_save_flushes_file_and_directory(tmp_path, monkeypatch):
    store = AuthTokenStore(tmp_path)
    flushed = record_fsyncs(monkeypatch)
    store.issue("11111111-1111-4111-8111-111111111111")
    assert flushed_file(flushed, tmp_path / "auth_tokens.json")
    assert flushed_directory(flushed, tmp_path)


def test_admin_token_issue_flushes_file_and_directory(tmp_path, monkeypatch):
    store = AuthTokenStore(tmp_path)
    flushed = record_fsyncs(monkeypatch)
    store.issue_admin_token("11111111-1111-4111-8111-111111111111", "ci")
    assert flushed_file(flushed, tmp_path / "auth_tokens.json")
    assert flushed_directory(flushed, tmp_path)


def test_auth_secret_flushes_file_and_directory(tmp_path, monkeypatch):
    """losing this file makes every stored second factor undecryptable"""
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(settings, "auth_secret", None)
    flushed = record_fsyncs(monkeypatch)
    secret = secret_box.get_auth_secret()
    assert (tmp_path / "auth_secret").read_text().strip() == secret
    assert flushed_file(flushed, tmp_path / "auth_secret")
    assert flushed_directory(flushed, tmp_path)


@pytest.mark.parametrize("break_it", [refuse_directory_open, refuse_directory_fsync])
def test_account_save_survives_without_directory_fsync(tmp_path, monkeypatch, break_it):
    """a platform that cannot flush a directory still saves; durability of
    the rename is then the platform's problem, not a reason to fail"""
    store = AccountStore(tmp_path)
    break_it(monkeypatch)
    store.create(make_account())
    monkeypatch.undo()
    assert AccountStore(tmp_path).count() == 1


@pytest.mark.parametrize("break_it", [refuse_directory_open, refuse_directory_fsync])
def test_auth_token_save_survives_without_directory_fsync(tmp_path, monkeypatch, break_it):
    store = AuthTokenStore(tmp_path)
    break_it(monkeypatch)
    raw = store.issue("11111111-1111-4111-8111-111111111111")
    monkeypatch.undo()
    assert AuthTokenStore(tmp_path).resolve(raw) == "11111111-1111-4111-8111-111111111111"


@pytest.mark.parametrize("break_it", [refuse_directory_open, refuse_directory_fsync])
def test_auth_secret_survives_without_directory_fsync(tmp_path, monkeypatch, break_it):
    monkeypatch.setattr(settings, "storage_path", tmp_path)
    monkeypatch.setattr(settings, "auth_secret", None)
    break_it(monkeypatch)
    secret = secret_box.get_auth_secret()
    monkeypatch.undo()
    assert (tmp_path / "auth_secret").read_text().strip() == secret


def test_failed_save_still_leaves_no_temp_file(tmp_path, monkeypatch):
    """the durability work must not strand a temp file on the failure path"""
    store = AccountStore(tmp_path)

    def explode(*args, **kwargs):
        raise OSError(errno.ENOSPC, "no space left on device")

    monkeypatch.setattr("json.dump", explode)
    with pytest.raises(OSError):
        store.create(make_account())
    monkeypatch.undo()
    assert not list(tmp_path.glob(".users_*.tmp"))
    assert not (tmp_path / "users.json").exists()
