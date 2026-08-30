"""per-account rate limiting shared by password login and 2FA verification.

in-memory sliding window: after MAX_FAILURES failed attempts inside WINDOW
seconds, further attempts are refused until the window frees. keyed by
lowercased account email so both login steps drain the same budget.

the key is attacker-supplied, so the table is bounded two ways: expired keys
are swept periodically rather than only when their own key is touched again,
and a hard cap evicts the least recently failing keys once the sweep cannot
get the table back under it. eviction only ever drops keys that are closest
to expiring anyway, and the cap sits far above any real instance's live set.
"""
from __future__ import annotations

import threading
import time
from typing import Callable

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60
MAX_TRACKED_KEYS = 10_000
SWEEP_INTERVAL_SECONDS = 60


class RateLimiter:
    def __init__(
        self,
        max_failures: int = MAX_FAILURES,
        window_seconds: float = WINDOW_SECONDS,
        now: Callable[[], float] | None = None,
        max_tracked_keys: int = MAX_TRACKED_KEYS,
        sweep_interval_seconds: float = SWEEP_INTERVAL_SECONDS,
    ):
        self._max_failures = max_failures
        self._window = window_seconds
        self._now = now or time.monotonic
        self._max_tracked_keys = max_tracked_keys
        self._sweep_interval = sweep_interval_seconds
        self._failures: dict[str, list[float]] = {}
        self._last_sweep = float("-inf")
        self._lock = threading.Lock()

    def _prune_locked(self, key: str):
        cutoff = self._now() - self._window
        kept = [t for t in self._failures.get(key, []) if t > cutoff]
        if kept:
            self._failures[key] = kept
        else:
            self._failures.pop(key, None)

    def _sweep_locked(self):
        """drop every expired key, then evict down to the cap if needed.

        runs on the interval, and unconditionally whenever the table is over
        the cap, so the cap holds no matter how fast keys arrive between
        scheduled sweeps.
        """
        now = self._now()
        over_cap = len(self._failures) > self._max_tracked_keys
        if not over_cap and now - self._last_sweep < self._sweep_interval:
            return
        self._last_sweep = now
        cutoff = now - self._window
        for key in [k for k, times in self._failures.items() if not times or times[-1] <= cutoff]:
            del self._failures[key]
        overflow = len(self._failures) - self._max_tracked_keys
        if overflow > 0:
            # oldest most-recent failure first: those free up soonest anyway
            stale = sorted(self._failures, key=lambda k: self._failures[k][-1])[:overflow]
            for key in stale:
                del self._failures[key]

    def allowed(self, key: str) -> bool:
        with self._lock:
            self._prune_locked(key)
            return len(self._failures.get(key, [])) < self._max_failures

    def record_failure(self, key: str):
        with self._lock:
            self._prune_locked(key)
            self._failures.setdefault(key, []).append(self._now())
            # sweep after the insert so the cap is a post-condition of every
            # recorded failure, not a bound the newest key can slip past
            self._sweep_locked()

    def reset(self, key: str):
        with self._lock:
            self._failures.pop(key, None)

    def tracked_keys(self) -> int:
        with self._lock:
            return len(self._failures)


login_limiter = RateLimiter()
