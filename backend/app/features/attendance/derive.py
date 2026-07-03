"""Pure derivation logic — no DB, no I/O, no SQLAlchemy.

This is the testable heart of the slice: geofence math and the per-day status
rollup. Everything here works on **naive local wall-clock** datetimes; the
service is responsible for converting the authoritative UTC ``server_time`` into
the shop's local timezone before calling in. Keeping it pure means the manager
board/grid logic is unit-tested without a database (matching how the media slice
unit-tests its service).

The haversine itself lives in ``app.shared.geo`` (the jobs slice needs it too,
and cross-slice imports of another slice's internals are off-limits).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta

from app.shared.geo import haversine_m

# Mirror of models.PunchKind values, kept as literals so this module imports
# nothing internal.
CLOCK_IN = "clock_in"
CLOCK_OUT = "clock_out"

# Status vocabulary — matches the web mock (src/features/attendance/lib/cells.js).
# `late` is a separate boolean flag layered on top of `present`, not a status.
PRESENT = "present"
FIELD = "field"
HALF = "half"
ABSENT = "absent"
HOLIDAY = "holiday"
LEAVE = "leave"  # manager-set only (leave workflow deferred); never derived here.


@dataclass(frozen=True)
class ShiftSpec:
    """The bits of a shift the derivation needs. ``working_days`` is a 7-char
    Mon→Sun bitmask (``"1111110"`` = Mon–Sat)."""

    start_local: time
    end_local: time
    working_days: str = "1111110"
    grace_minutes: int = 10


DEFAULT_TIMEZONE = "Asia/Karachi"
DEFAULT_SHIFT = ShiftSpec(start_local=time(9, 0), end_local=time(18, 0))


@dataclass(frozen=True)
class LocalPunch:
    """A punch projected into shop-local wall-clock time."""

    kind: str
    local_dt: datetime  # naive, shop-local
    inside_geofence: bool | None  # None = geofence inactive / location unknown


@dataclass(frozen=True)
class DayRollup:
    day: date
    status: str
    first_in: datetime | None  # naive, shop-local
    last_out: datetime | None  # naive, shop-local
    worked_minutes: int | None
    late: bool
    # The day's punches don't make chronological sense: a clock-out with no
    # clock-in, or the last clock-out lands before the first clock-in. Worked
    # minutes still clamp to 0 (payroll stays sane); this flag surfaces the
    # oddity for a manager to check rather than swallowing it silently.
    order_violation: bool = False


# ── Geofence ─────────────────────────────────────────────────────────────────
def geofence_flags(
    lat: float,
    lng: float,
    *,
    center_lat: float,
    center_lng: float,
    radius_m: float,
    accuracy_m: float = 0.0,
) -> tuple[bool, float]:
    """Return ``(inside, distance_m)`` for a punch against a workshop circle.

    ``accuracy_m`` is the GPS fix's confidence radius: the punch counts as
    inside when its confidence circle *overlaps* the fence
    (``distance - accuracy <= radius``), so a fuzzy-but-honest fix taken inside
    the workshop isn't mislabelled "outside". Whether a fix is too coarse to
    judge at all is the caller's policy, not geometry — see the service's
    accuracy ceiling.
    """
    distance = haversine_m(lat, lng, center_lat, center_lng)
    return distance - accuracy_m <= radius_m, distance


# ── Daily status ─────────────────────────────────────────────────────────────
def classify_day(*, day: date, punches: list[LocalPunch], shift: ShiftSpec) -> DayRollup:
    """Fold one tech's punches for one local day into a status rollup.

    Contract: call only for days on or before "today" — the caller decides the
    day range; a future day with no punches would be mislabelled ``absent``.

    Rules (matching the web vocabulary):
      * non-working day              → ``holiday``
      * working day, no clock-in     → ``absent``
      * first clock-in outside fence → ``field``  (legit offsite punch)
      * worked < half the shift      → ``half``
      * otherwise                    → ``present``
      * clock-in after start + grace → ``late`` flag (independent of status)
    """
    if not _is_working_day(day, shift.working_days):
        return DayRollup(day, HOLIDAY, None, None, None, False)

    clock_ins = sorted((p for p in punches if p.kind == CLOCK_IN), key=lambda p: p.local_dt)
    clock_outs = sorted((p for p in punches if p.kind == CLOCK_OUT), key=lambda p: p.local_dt)

    if not clock_ins:
        # A clock-out with nothing to close is itself an ordering violation.
        return DayRollup(day, ABSENT, None, None, None, False, order_violation=bool(clock_outs))

    first = clock_ins[0]
    first_in = first.local_dt
    last_out = clock_outs[-1].local_dt if clock_outs else None

    grace_cutoff = datetime.combine(day, shift.start_local) + timedelta(minutes=shift.grace_minutes)
    late = first_in > grace_cutoff

    worked_minutes: int | None = None
    order_violation = False
    if last_out is not None:
        minutes = int((last_out - first_in).total_seconds() // 60)
        worked_minutes = max(minutes, 0)
        order_violation = last_out < first_in

    if first.inside_geofence is False:
        status = FIELD
    elif worked_minutes is not None and worked_minutes < _shift_length_minutes(shift) / 2:
        status = HALF
    else:
        status = PRESENT

    return DayRollup(
        day, status, first_in, last_out, worked_minutes, late, order_violation=order_violation
    )


def _is_working_day(day: date, working_days: str) -> bool:
    idx = day.weekday()  # Monday = 0 … Sunday = 6
    return idx < len(working_days) and working_days[idx] == "1"


def _shift_length_minutes(shift: ShiftSpec) -> int:
    start = datetime.combine(date.min, shift.start_local)
    end = datetime.combine(date.min, shift.end_local)
    minutes = int((end - start).total_seconds() // 60)
    return minutes if minutes > 0 else minutes + 24 * 60


# ── On-duty pings → away intervals (D4) ───────────────────────────────────────
# Interval kinds. `inside` = the phone was in the fence; `outside` = it was out;
# `no_data` = coverage was lost (a gap longer than 2× the ping cadence).
INSIDE = "inside"
OUTSIDE = "outside"
NO_DATA = "no_data"


@dataclass(frozen=True)
class PingSample:
    """One on-duty ping projected to shop-local wall-clock. ``inside`` is the
    geofence verdict (``None`` = accuracy-uncertain / unjudgeable)."""

    local_dt: datetime  # naive, shop-local
    inside: bool | None


@dataclass(frozen=True)
class DutyInterval:
    """A run within the clocked window of a single kind (``inside`` / ``outside``
    / ``no_data``), in shop-local naive time."""

    start: datetime
    end: datetime
    kind: str


@dataclass(frozen=True)
class DutySummary:
    inside_minutes: int
    outside_minutes: int
    no_data_minutes: int
    coverage_pct: float  # (inside + outside) / total, 0–100


def _span_minutes(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() // 60)


def duty_intervals(
    samples: list[PingSample],
    window_start: datetime,
    window_end: datetime,
    interval_minutes: int,
) -> list[DutyInterval]:
    """Partition the clocked window into ``inside`` / ``outside`` / ``no_data``
    runs from the on-duty pings (D4).

    Rules:
      * a stretch longer than **2× the ping cadence** with no sample is
        ``no_data`` — coverage was lost, and we never guess what happened;
      * between covered samples the state is a step function of the geofence
        verdict (a sample governs forward to the next sample; the leading span is
        backfilled from the first sample);
      * an accuracy-uncertain (``None``) sample still counts as coverage (it
        keeps the gap small) but carries the *current* verdict forward — it never
        opens or closes an ``outside`` run;
      * everything is clamped to ``[window_start, window_end]``.

    Pure: the service supplies the window + samples already in shop-local naive
    time. Empty input over a real window is a single ``no_data`` interval.
    """
    if window_end <= window_start:
        return []
    gap = timedelta(minutes=2 * interval_minutes)
    pts = sorted(
        (s for s in samples if window_start <= s.local_dt <= window_end),
        key=lambda s: s.local_dt,
    )
    if not pts:
        return [DutyInterval(window_start, window_end, NO_DATA)]

    # Resolve each sample's verdict, carrying the last KNOWN one forward; leading
    # uncertain samples are backfilled from the first known verdict (else inside,
    # the benign default — we never invent an outside run from thin air).
    resolved_raw: list[str | None] = []
    last: str | None = None
    for p in pts:
        if p.inside is True:
            last = INSIDE
        elif p.inside is False:
            last = OUTSIDE
        resolved_raw.append(last)
    first_known = next((r for r in resolved_raw if r is not None), INSIDE)
    resolved: list[str] = [r if r is not None else first_known for r in resolved_raw]

    raw: list[DutyInterval] = []

    def add(a: datetime, b: datetime, covered_kind: str) -> None:
        if b <= a:
            return
        raw.append(DutyInterval(a, b, NO_DATA if (b - a) > gap else covered_kind))

    add(window_start, pts[0].local_dt, resolved[0])
    for i in range(len(pts) - 1):
        add(pts[i].local_dt, pts[i + 1].local_dt, resolved[i])
    add(pts[-1].local_dt, window_end, resolved[-1])

    # Merge adjacent same-kind runs (the leading span + the first segment share a
    # governing sample, contiguous outside samples coalesce, etc.).
    merged: list[DutyInterval] = []
    for iv in raw:
        if merged and merged[-1].kind == iv.kind and merged[-1].end == iv.start:
            prev = merged[-1]
            merged[-1] = DutyInterval(prev.start, iv.end, prev.kind)
        else:
            merged.append(iv)
    return merged


def duty_summary(intervals: list[DutyInterval]) -> DutySummary:
    """Fold duty intervals into per-kind minutes + a coverage %. Coverage is the
    share of the window with actual ping data (inside + outside), so a day the
    phone never reported reads 0% — the manager sees the absence, not a guess."""
    inside = sum(_span_minutes(iv.start, iv.end) for iv in intervals if iv.kind == INSIDE)
    outside = sum(_span_minutes(iv.start, iv.end) for iv in intervals if iv.kind == OUTSIDE)
    no_data = sum(_span_minutes(iv.start, iv.end) for iv in intervals if iv.kind == NO_DATA)
    total = inside + outside + no_data
    coverage = round((inside + outside) / total * 100, 1) if total else 0.0
    return DutySummary(inside, outside, no_data, coverage)
