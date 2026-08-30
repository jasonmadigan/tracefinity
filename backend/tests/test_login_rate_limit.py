"""rate limiter window behaviour, bounding, and pending login token lifecycle."""
from app.services.login_rate_limit import RateLimiter
from app.services.pending_login import MAX_ATTEMPTS, PENDING_TTL_SECONDS, PendingLoginStore


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_limiter_blocks_after_max_failures():
    clock = Clock()
    limiter = RateLimiter(max_failures=3, window_seconds=60, now=clock)
    for _ in range(3):
        assert limiter.allowed("a@example.com")
        limiter.record_failure("a@example.com")
    assert not limiter.allowed("a@example.com")
    # a different account is unaffected
    assert limiter.allowed("b@example.com")


def test_limiter_window_frees():
    clock = Clock()
    limiter = RateLimiter(max_failures=2, window_seconds=60, now=clock)
    limiter.record_failure("a@example.com")
    limiter.record_failure("a@example.com")
    assert not limiter.allowed("a@example.com")
    clock.t = 61
    assert limiter.allowed("a@example.com")


def test_limiter_reset_on_success():
    limiter = RateLimiter(max_failures=1, window_seconds=60)
    limiter.record_failure("a@example.com")
    assert not limiter.allowed("a@example.com")
    limiter.reset("a@example.com")
    assert limiter.allowed("a@example.com")


def test_limiter_sweeps_expired_keys_it_never_sees_again():
    """a unique-email spray must not grow the table for the process lifetime"""
    clock = Clock()
    limiter = RateLimiter(
        max_failures=10, window_seconds=60, now=clock, sweep_interval_seconds=10
    )
    for n in range(500):
        limiter.record_failure(f"spray{n}@example.com")
    assert limiter.tracked_keys() == 500

    # every key is expired and the sweep interval has passed
    clock.t = 200
    limiter.record_failure("real@example.com")
    assert limiter.tracked_keys() == 1


def test_limiter_caps_tracked_keys_within_a_single_window():
    """even a spray fast enough that nothing expires stays bounded"""
    clock = Clock()
    limiter = RateLimiter(
        max_failures=10,
        window_seconds=600,
        now=clock,
        max_tracked_keys=50,
        sweep_interval_seconds=0,
    )
    for n in range(400):
        clock.t = n
        limiter.record_failure(f"spray{n}@example.com")
    assert limiter.tracked_keys() <= 50


def test_eviction_keeps_the_most_recent_offenders():
    clock = Clock()
    limiter = RateLimiter(
        max_failures=1,
        window_seconds=600,
        now=clock,
        max_tracked_keys=2,
        sweep_interval_seconds=0,
    )
    limiter.record_failure("old@example.com")
    clock.t = 1
    limiter.record_failure("recent@example.com")
    clock.t = 2
    limiter.record_failure("newest@example.com")

    assert limiter.tracked_keys() == 2
    # the oldest offender is the one that lost its budget, not the newest
    assert limiter.allowed("old@example.com")
    assert not limiter.allowed("newest@example.com")


def test_pending_token_expires():
    clock = Clock()
    store = PendingLoginStore(now=clock)
    token = store.issue("account-1")
    clock.t = PENDING_TTL_SECONDS + 1
    assert store.begin_attempt(token) is None
    # and it is gone for good
    clock.t = 0
    assert store.begin_attempt(token) is None


def test_pending_token_single_use():
    store = PendingLoginStore()
    token = store.issue("account-1")
    assert store.begin_attempt(token) == "account-1"
    store.redeem(token)
    assert store.begin_attempt(token) is None


def test_pending_token_attempts_bounded():
    store = PendingLoginStore()
    token = store.issue("account-1")
    for _ in range(MAX_ATTEMPTS):
        assert store.begin_attempt(token) == "account-1"
    assert store.begin_attempt(token) is None


def test_unknown_pending_token():
    store = PendingLoginStore()
    assert store.begin_attempt("nope") is None
