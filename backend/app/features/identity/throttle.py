"""Login-throttle policy — pure functions, no DB, no clock of their own.

The DB holds the state (``failed_attempts`` / ``locked_until`` on the
technician row); this module is the *policy* over that state, kept pure so it's
exhaustively unit-testable. ``service.login`` calls it with ``now`` injected.

Design intent (one manager account → never hard-lock):
  * The lock always **decays** — at most ``MAX_LOCK_SECONDS``.
  * Escalation **persists** across an expired lock because ``failed_attempts``
    only resets on a *successful* login, never on lock expiry. So a determined
    sprayer faces a longer wait each round without the account ever bricking.
  * A per-IP limiter (in ``deps``/router) blunts roster-wide spraying; this
    per-account policy is the real defense.
"""

from __future__ import annotations

from datetime import datetime, timedelta

# Start locking from this many consecutive failures.
LOCK_THRESHOLD = 5
# Base lock once the threshold is crossed; doubles per extra failure.
BASE_LOCK_SECONDS = 30
# Hard ceiling — the lock never exceeds this, so it is always self-healing.
MAX_LOCK_SECONDS = 15 * 60


def is_locked(locked_until: datetime | None, now: datetime) -> bool:
    """True if a lock is currently in effect."""
    return locked_until is not None and locked_until > now


def retry_after_seconds(locked_until: datetime | None, now: datetime) -> int:
    """Whole seconds until the lock lifts (>=1 while locked, else 0)."""
    if locked_until is None or locked_until <= now:
        return 0
    return max(1, int((locked_until - now).total_seconds()))


def lock_duration_seconds(failed_attempts: int) -> int:
    """Lock length for a given (post-increment) consecutive-failure count.

    0 below the threshold; from the threshold up it is
    ``BASE * 2**(n - THRESHOLD)`` capped at ``MAX_LOCK_SECONDS``.
    """
    if failed_attempts < LOCK_THRESHOLD:
        return 0
    over = failed_attempts - LOCK_THRESHOLD
    # Cap the exponent before shifting so a large failure count can't overflow.
    if over >= 32:  # 30 << 32 already dwarfs the 15-min cap
        return MAX_LOCK_SECONDS
    return min(BASE_LOCK_SECONDS << over, MAX_LOCK_SECONDS)


def next_lock_until(failed_attempts: int, now: datetime) -> datetime | None:
    """The new ``locked_until`` after recording a failure, or ``None`` if the
    failure count is still below the lock threshold."""
    seconds = lock_duration_seconds(failed_attempts)
    return now + timedelta(seconds=seconds) if seconds else None


class IpRateLimiter:
    """Sliding-window cap on login attempts per client IP.

    In-memory by design: the deployment is a single replica (documented in the
    remediation plan) and the DB-backed per-account lockout above is the real
    defense — this only blunts roster-wide spraying. ``now`` is injected
    (seconds, any monotonic-ish source) so the policy is unit-testable.
    """

    def __init__(self, max_attempts: int = 20, window_seconds: float = 60.0) -> None:
        self._max = max_attempts
        self._window = window_seconds
        self._hits: dict[str, list[float]] = {}

    def allow(self, ip: str, now: float) -> bool:
        """Record an attempt and report whether it is within the cap."""
        cutoff = now - self._window
        hits = [t for t in self._hits.get(ip, []) if t > cutoff]
        allowed = len(hits) < self._max
        if allowed:
            hits.append(now)
        self._hits[ip] = hits
        # Opportunistic global prune so dead IPs can't grow the dict forever.
        if len(self._hits) > 4096:
            self._hits = {k: v for k, v in self._hits.items() if v and v[-1] > cutoff}
        return allowed
