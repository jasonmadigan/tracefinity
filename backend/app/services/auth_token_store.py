"""auth tokens in auth_tokens.json at the storage root.

tokens are opaque secrets.token_urlsafe values stored only as sha256 hashes
with an expiry. lifetime is 14 days, sliding: use extends expiry, persisted
at most hourly so routine requests do not rewrite the file.
"""
from __future__ import annotations

import hashlib
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


class AuthTokenRecord(BaseModel):
    account_id: str
    created_at: str
    expires_at: str


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
            if datetime.fromisoformat(r.expires_at) <= now
        ]
        for h in expired:
            del self._tokens[h]

    def issue(self, account_id: str) -> str:
        """create a token for the account; returns the raw value (never stored)"""
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
        """account id for a valid token, sliding its expiry; none otherwise"""
        token_hash = _hash_token(raw)
        now = self._now()
        with self._lock:
            record = self._tokens.get(token_hash)
            if record is None:
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
        with self._lock:
            if self._tokens.pop(_hash_token(raw), None) is not None:
                self._save()

    def revoke_for_account(self, account_id: str, keep_raw: str | None = None):
        """drop every token for the account, optionally keeping one (the
        caller's own, e.g. after a self-service password change)"""
        keep_hash = _hash_token(keep_raw) if keep_raw else None
        with self._lock:
            doomed = [
                h for h, r in self._tokens.items()
                if r.account_id == account_id and h != keep_hash
            ]
            for h in doomed:
                del self._tokens[h]
            if doomed:
                self._save()


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
