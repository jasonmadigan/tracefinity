"""single-use pending tokens bridging the two steps of a 2FA login.

password verification mints one; redeeming it with a TOTP or backup code
completes login. tokens live five minutes, allow a bounded number of code
attempts, and are held only in memory: a restart just means logging in again.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

PENDING_TTL_SECONDS = 5 * 60
MAX_ATTEMPTS = 5


@dataclass
class PendingLogin:
    account_id: str
    expires_at: float
    attempts_left: int


class PendingLoginStore:
    def __init__(self, now: Callable[[], float] | None = None):
        self._pending: dict[str, PendingLogin] = {}
        self._lock = threading.Lock()
        self._now = now or time.monotonic

    def issue(self, account_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock:
            self._pending[token] = PendingLogin(
                account_id=account_id,
                expires_at=self._now() + PENDING_TTL_SECONDS,
                attempts_left=MAX_ATTEMPTS,
            )
        return token

    def begin_attempt(self, token: str) -> Optional[str]:
        """consume one attempt; returns the account id or none when the token
        is unknown, expired, or out of attempts (in which case it is dropped)"""
        with self._lock:
            pending = self._pending.get(token)
            if pending is None:
                return None
            if pending.expires_at <= self._now() or pending.attempts_left <= 0:
                del self._pending[token]
                return None
            pending.attempts_left -= 1
            if pending.attempts_left <= 0:
                # this is the final attempt; the token dies with it either way
                del self._pending[token]
            return pending.account_id

    def redeem(self, token: str):
        """single use: a successful verification removes the token"""
        with self._lock:
            self._pending.pop(token, None)


pending_logins = PendingLoginStore()
