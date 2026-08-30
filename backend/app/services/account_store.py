"""account records in users.json at the storage root.

same atomic mkstemp+replace pattern as the per-user stores. accounts are
instance-level data, so the store lives beside (not inside) user dirs.
"""
from __future__ import annotations

import json
import logging
import tempfile
import threading
from pathlib import Path
from typing import Callable, Optional

from app.config import settings
from app.models.accounts import Account

logger = logging.getLogger(__name__)


class DuplicateAccountError(ValueError):
    """id or email already taken"""


class LastAdminError(RuntimeError):
    """this change would leave the instance with no way back in"""


class AccountStore:
    def __init__(self, storage_path: Path):
        self.file_path = storage_path / "users.json"
        self._accounts: dict[str, Account] = {}
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for account_id, record in data.items():
                    self._accounts[account_id] = Account.model_validate(record)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception:
                # never turn a corrupt credential store into an empty one:
                # that would reopen first-run setup on a live instance
                logger.error(f"Failed to load {self.file_path}: corrupt account data")
                raise

    def _save(self):
        # runs with self._lock held
        data = {account_id: a.model_dump() for account_id, a in self._accounts.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent, prefix=".users_", suffix=".tmp"
        )
        try:
            with open(temp_fd, "w") as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    @staticmethod
    def _has_enabled_admin(accounts) -> bool:
        """the instance-level invariant: someone can still administer it"""
        return any(a.is_admin and not a.disabled for a in accounts)

    def get(self, account_id: str) -> Optional[Account]:
        with self._lock:
            account = self._accounts.get(account_id)
            return account.model_copy() if account else None

    def get_by_email(self, email: str) -> Optional[Account]:
        needle = email.strip().lower()
        with self._lock:
            for account in self._accounts.values():
                if account.email == needle:
                    return account.model_copy()
            return None

    def all(self) -> list[Account]:
        with self._lock:
            return [a.model_copy() for a in self._accounts.values()]

    def count(self) -> int:
        with self._lock:
            return len(self._accounts)

    def create(self, account: Account):
        """add a new account atomically; refuses duplicate id or email"""
        with self._lock:
            if account.id in self._accounts:
                raise DuplicateAccountError("account id already exists")
            if any(a.email == account.email for a in self._accounts.values()):
                raise DuplicateAccountError("email already registered")
            self._accounts[account.id] = account.model_copy()
            try:
                self._save()
            except Exception:
                # partial failure leaves nothing behind
                self._accounts.pop(account.id, None)
                raise

    def create_first_admin(self, account: Account) -> bool:
        """create the first account iff none exist; the losing racer gets false"""
        with self._lock:
            if self._accounts:
                return False
            self._accounts[account.id] = account.model_copy()
            try:
                self._save()
            except Exception:
                self._accounts.pop(account.id, None)
                raise
            return True

    def mutate(
        self, account_id: str, fn: Callable[[Account], Optional[Account]]
    ) -> Optional[Account]:
        """apply fn to the live record under the store lock; fn returns the
        replacement or none to abort. a compare-and-set for security state
        (TOTP replay steps, backup code consumption) where a read-then-write
        from a stale copy would race a concurrent login."""
        with self._lock:
            current = self._accounts.get(account_id)
            if current is None:
                return None
            replacement = fn(current.model_copy())
            if replacement is None:
                return None
            had_admin = self._has_enabled_admin(self._accounts.values())
            self._accounts[account_id] = replacement.model_copy()
            # a route-level check races: two administrators disabling each
            # other both pass it and both land. gate on whether this change
            # is what breaks the invariant, not on whether it holds now, so
            # enabling an account can still repair an instance that arrived
            # broken
            if had_admin and not self._has_enabled_admin(self._accounts.values()):
                self._accounts[account_id] = current
                raise LastAdminError(
                    "this is the only enabled administrator; enable or create "
                    "another administrator before disabling this account"
                )
            try:
                self._save()
            except Exception:
                self._accounts[account_id] = current
                raise
            return replacement

    def delete(self, account_id: str) -> Optional[Account]:
        """remove an account, refusing to strand the instance.

        first-run setup only opens on an empty store, so an instance left
        with accounts but no usable administrator can never be recovered
        through the product. deleting the only account is always allowed:
        that returns the instance to first run.
        """
        with self._lock:
            account = self._accounts.get(account_id)
            if account is None:
                return None
            remaining = [a for a in self._accounts.values() if a.id != account_id]
            if remaining and not self._has_enabled_admin(remaining):
                raise LastAdminError(
                    "this is the only administrator; promote or create another "
                    "administrator before deleting this account"
                )
            del self._accounts[account_id]
            try:
                self._save()
            except Exception:
                self._accounts[account_id] = account
                raise
            return account


_store: AccountStore | None = None
_store_guard = threading.Lock()


def get_account_store() -> AccountStore:
    """singleton keyed on the configured storage path so tests that repoint
    settings.storage_path get a fresh store automatically"""
    global _store
    with _store_guard:
        expected = Path(settings.storage_path) / "users.json"
        if _store is None or _store.file_path != expected:
            _store = AccountStore(Path(settings.storage_path))
        return _store


def reset_account_store():
    global _store
    with _store_guard:
        _store = None
