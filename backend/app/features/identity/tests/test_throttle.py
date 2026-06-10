"""Unit tests for the login-throttle policy — pure functions, injected clock."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.features.identity.throttle import (
    BASE_LOCK_SECONDS,
    LOCK_THRESHOLD,
    MAX_LOCK_SECONDS,
    IpRateLimiter,
    is_locked,
    lock_duration_seconds,
    next_lock_until,
    retry_after_seconds,
)

NOW = datetime(2026, 6, 10, 12, 0, 0, tzinfo=UTC)


def test_no_lock_below_threshold() -> None:
    for n in range(LOCK_THRESHOLD):
        assert lock_duration_seconds(n) == 0
        assert next_lock_until(n, NOW) is None


def test_lock_doubles_from_threshold_and_caps() -> None:
    assert lock_duration_seconds(LOCK_THRESHOLD) == BASE_LOCK_SECONDS
    assert lock_duration_seconds(LOCK_THRESHOLD + 1) == BASE_LOCK_SECONDS * 2
    assert lock_duration_seconds(LOCK_THRESHOLD + 2) == BASE_LOCK_SECONDS * 4
    # The cap is the design: there is one manager account — the lock must
    # always self-heal, never hard-lock.
    assert lock_duration_seconds(LOCK_THRESHOLD + 20) == MAX_LOCK_SECONDS
    assert lock_duration_seconds(10_000) == MAX_LOCK_SECONDS  # no overflow


def test_is_locked_and_retry_after() -> None:
    until = NOW + timedelta(seconds=90)
    assert is_locked(until, NOW) is True
    assert retry_after_seconds(until, NOW) == 90
    assert is_locked(until, NOW + timedelta(seconds=91)) is False
    assert retry_after_seconds(until, NOW + timedelta(seconds=91)) == 0
    assert is_locked(None, NOW) is False


def test_retry_after_is_at_least_one_second_while_locked() -> None:
    until = NOW + timedelta(milliseconds=300)
    assert retry_after_seconds(until, NOW) == 1


def test_ip_limiter_allows_under_cap_then_denies() -> None:
    limiter = IpRateLimiter(max_attempts=3, window_seconds=60)
    assert limiter.allow("1.2.3.4", now=0.0) is True
    assert limiter.allow("1.2.3.4", now=1.0) is True
    assert limiter.allow("1.2.3.4", now=2.0) is True
    assert limiter.allow("1.2.3.4", now=3.0) is False
    # A different IP is unaffected.
    assert limiter.allow("5.6.7.8", now=3.0) is True


def test_ip_limiter_window_slides() -> None:
    limiter = IpRateLimiter(max_attempts=2, window_seconds=10)
    assert limiter.allow("ip", now=0.0) is True
    assert limiter.allow("ip", now=1.0) is True
    assert limiter.allow("ip", now=2.0) is False
    # The first two attempts age out of the window → allowed again.
    assert limiter.allow("ip", now=11.5) is True
