"""auth tokens in auth_tokens.json at the storage root.

tokens are opaque secrets.token_urlsafe values stored only as sha256 hashes.
two kinds share the file:

login tokens back the browser cookie. lifetime is 14 days, sliding: use
extends expiry, persisted at most hourly so routine requests do not rewrite
the file.

admin tokens authenticate automation to the admin API. they carry a handle so
one can be revoked without touching the rest, never slide, and by default
never expire. the two kinds are never interchangeable: each resolver only
accepts its own, so a cookie value is not a bearer credential and an admin
token pasted into the cookie authenticates nothing.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel

from app.config import settings

logger = logging.getLogger(__name__)

TOKEN_LIFETIME = timedelta(days=14)
# skip the disk write when sliding would move expiry by less than this
_SLIDE_WRITE_THRESHOLD = timedelta(hours=1)

LOGIN_KIND = "login"
ADMIN_KIND = "admin"
# marks the credential wherever it turns up: a secret scanner can match it,
# and an operator can tell it from a cookie value at a glance
ADMIN_TOKEN_PREFIX = "tfadm_"


class AuthTokenRecord(BaseModel):
    account_id: str
    created_at: str
    # login tokens always expire; an admin token may be perpetual
    expires_at: str | None
    kind: str = LOGIN_KIND
    # admin tokens only: the handle revocation names, and operator context
    token_id: str = ""
    label: str = ""
    last_used_at: str | None = None


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


class AuthTokenStore:
    def __init__(self, storage_path: Path, now: Callable[[], datetime] | None = None):
        self.file_path = storage_path / "auth_tokens.json"
        self._tokens: dict[str, AuthTokenRecord] = {}
        self._lock = threading.Lock()
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._load()

    def _load(self):
        if self.file_path.exists():
            try:
                data = json.loads(self.file_path.read_text())
                for token_hash, record in data.items():
                    self._tokens[token_hash] = AuthTokenRecord.model_validate(record)
            except OSError:
                logger.error(f"Failed to load {self.file_path}: permission denied")
                raise
            except Exception as e:
                # losing tokens only forces re-login; never blocks startup
                logger.error(f"Failed to load {self.file_path}: {e}")
                self._tokens = {}

    def _save(self):
        # runs with self._lock held
        data = {h: r.model_dump() for h, r in self._tokens.items()}
        temp_fd, temp_path = tempfile.mkstemp(
            dir=self.file_path.parent, prefix=".auth_tokens_", suffix=".tmp"
        )
        try:
            with open(temp_fd, "w") as f:
                json.dump(data, f, indent=2)
            Path(temp_path).replace(self.file_path)
        except Exception:
            Path(temp_path).unlink(missing_ok=True)
            raise

    def _purge_expired_locked(self):
        now = self._now()
        expired = [
            h for h, r in self._tokens.items()
            if r.expires_at is not None and datetime.fromisoformat(r.expires_at) <= now
        ]
        for h in expired:
            del self._tokens[h]

    def issue(self, account_id: str) -> str:
        """create a login token for the account; returns the raw value
        (never stored)"""
        raw = secrets.token_urlsafe(32)
        now = self._now()
        with self._lock:
            self._purge_expired_locked()
            self._tokens[_hash_token(raw)] = AuthTokenRecord(
                account_id=account_id,
                created_at=now.isoformat(),
                expires_at=(now + TOKEN_LIFETIME).isoformat(),
            )
            self._save()
        return raw

    def resolve(self, raw: str) -> Optional[str]:
        """account id for a valid login token, sliding its expiry; none
        otherwise. an admin token presented here is not a login."""
        token_hash = _hash_token(raw)
        now = self._now()
        with self._lock:
            record = self._tokens.get(token_hash)
            if record is None or record.kind != LOGIN_KIND:
                return None
            expires_at = datetime.fromisoformat(record.expires_at)
            if expires_at <= now:
                del self._tokens[token_hash]
                self._save()
                return None
            slid = now + TOKEN_LIFETIME
            if slid - expires_at >= _SLIDE_WRITE_THRESHOLD:
                record.expires_at = slid.isoformat()
                self._save()
            return record.account_id

    def revoke(self, raw: str):
        """drop a login token (logout)"""
        token_hash = _hash_token(raw)
        with self._lock:
            record = self._tokens.get(token_hash)
            if record is not None and record.kind == LOGIN_KIND:
                del self._tokens[token_hash]
                self._save()

    def revoke_for_account(self, account_id: str, keep_raw: str | None = None):
        """drop every login token for the account, optionally keeping one (the
        caller's own, e.g. after a self-service password change).

        admin tokens are deliberately left alone. they are not browser
        sessions: a password rotation is not evidence that a provisioning
        credential leaked, and silently breaking automation on every password
        change would teach operators to avoid rotating. revoke them
        explicitly, or disable the account to make them inert at once.
        """
        keep_hash = _hash_token(keep_raw) if keep_raw else None
        with self._lock:
            doomed = [
                h for h, r in self._tokens.items()
                if r.account_id == account_id and r.kind == LOGIN_KIND and h != keep_hash
            ]
            for h in doomed:
                del self._tokens[h]
            if doomed:
                self._save()

    def revoke_all_for_account(self, account_id: str):
        """drop everything the account holds, of either kind. for deletion:
        the account is gone, so nothing issued under it may outlive it"""
        with self._lock:
            doomed = [h for h, r in self._tokens.items() if r.account_id == account_id]
            for h in doomed:
                del self._tokens[h]
            if doomed:
                self._save()

    # --- admin tokens ---

    def issue_admin_token(
        self, account_id: str, label: str = "", expires_at: datetime | None = None
    ) -> tuple[AuthTokenRecord, str]:
        """mint an admin token; returns (record, raw). the raw value is never
        stored and cannot be recovered afterwards."""
        raw = ADMIN_TOKEN_PREFIX + secrets.token_urlsafe(32)
        now = self._now()
        with self._lock:
            self._purge_expired_locked()
            taken = {r.token_id for r in self._tokens.values()}
            token_id = secrets.token_hex(8)
            while token_id in taken:
                token_id = secrets.token_hex(8)
            record = AuthTokenRecord(
                account_id=account_id,
                created_at=now.isoformat(),
                expires_at=expires_at.isoformat() if expires_at else None,
                kind=ADMIN_KIND,
                token_id=token_id,
                label=label,
            )
            self._tokens[_hash_token(raw)] = record
            self._save()
        return record.model_copy(), raw

    def resolve_admin_token(self, raw: str) -> Optional[tuple[str, str]]:
        """(account_id, token_id) for a live admin token, else none.

        compares with hmac.compare_digest over the whole admin set rather than
        a dict lookup, and does not stop at the match: the value compared is
        derived from a secret, and the set is small enough that a linear scan
        costs nothing. expiry never slides, so using a token that was issued
        with a deadline cannot push that deadline out.
        """
        computed = _hash_token(raw)
        now = self._now()
        with self._lock:
            found: Optional[str] = None
            for token_hash, record in self._tokens.items():
                if record.kind != ADMIN_KIND:
                    continue
                if hmac.compare_digest(token_hash, computed):
                    found = token_hash
            if found is None:
                return None
            record = self._tokens[found]
            if record.expires_at is not None and datetime.fromisoformat(record.expires_at) <= now:
                del self._tokens[found]
                self._save()
                return None
            previous = record.last_used_at
            record.last_used_at = now.isoformat()
            # same throttle as the sliding cookie: a busy provisioner must not
            # rewrite the file on every call
            if previous is None or now - datetime.fromisoformat(previous) >= _SLIDE_WRITE_THRESHOLD:
                self._save()
            return record.account_id, record.token_id

    def list_admin_tokens(self) -> list[AuthTokenRecord]:
        """every live admin token on the instance, oldest first.

        instance-wide on purpose: whoever is containing a leak must be able to
        see and revoke a credential another administrator issued. a read, so
        expired records are filtered rather than deleted here.
        """
        now = self._now()
        with self._lock:
            records = [
                r.model_copy()
                for r in self._tokens.values()
                if r.kind == ADMIN_KIND
                and (r.expires_at is None or datetime.fromisoformat(r.expires_at) > now)
            ]
        return sorted(records, key=lambda r: r.created_at)

    def revoke_admin_token(self, token_id: str) -> bool:
        with self._lock:
            for token_hash, record in self._tokens.items():
                if record.kind == ADMIN_KIND and record.token_id == token_id:
                    del self._tokens[token_hash]
                    self._save()
                    return True
        return False


_store: AuthTokenStore | None = None
_store_guard = threading.Lock()


def get_auth_token_store() -> AuthTokenStore:
    global _store
    with _store_guard:
        expected = Path(settings.storage_path) / "auth_tokens.json"
        if _store is None or _store.file_path != expected:
            _store = AuthTokenStore(Path(settings.storage_path))
        return _store


def reset_auth_token_store():
    global _store
    with _store_guard:
        _store = None
