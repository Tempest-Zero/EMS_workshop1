"""Unit tests for the pure derivation logic (no DB, no I/O)."""

from __future__ import annotations

from datetime import date, datetime, time

from app.features.attendance.derive import (
    DEFAULT_SHIFT,
    LocalPunch,
    ShiftSpec,
    classify_day,
    geofence_flags,
)
from app.shared.geo import haversine_m


def _in(d: date, h: int, m: int, *, inside: bool | None = True) -> LocalPunch:
    return LocalPunch("clock_in", datetime.combine(d, time(h, m)), inside)


def _out(d: date, h: int, m: int) -> LocalPunch:
    return LocalPunch("clock_out", datetime.combine(d, time(h, m)), None)


# A Wednesday (working day under the default Mon–Sat mask).
WORKDAY = date(2026, 6, 3)
# A Sunday (non-working under "1111110").
SUNDAY = date(2026, 6, 7)


# ── haversine / geofence ─────────────────────────────────────────────────────
def test_haversine_zero_for_same_point() -> None:
    assert haversine_m(24.86, 67.00, 24.86, 67.00) == 0.0


def test_haversine_known_short_distance() -> None:
    # ~0.001 deg of latitude ≈ 111 m. Allow a small tolerance.
    d = haversine_m(24.8600, 67.0000, 24.8610, 67.0000)
    assert 105 < d < 118


def test_geofence_inside_and_outside() -> None:
    center = {"center_lat": 24.8600, "center_lng": 67.0000, "radius_m": 150.0}
    inside, dist_in = geofence_flags(24.8601, 67.0001, **center)
    outside, dist_out = geofence_flags(24.8700, 67.0100, **center)
    assert inside is True and dist_in <= 150
    assert outside is False and dist_out > 150


def test_geofence_accuracy_buffer_rescues_a_fuzzy_inside_fix() -> None:
    # ~111 m from center, 80 m radius: a raw fix reads "outside", but with a
    # 50 m confidence circle it overlaps the fence → inside (the tech standing
    # in the workshop with a fuzzy indoor fix must not be flagged off-site).
    center = {"center_lat": 24.8600, "center_lng": 67.0000, "radius_m": 80.0}
    raw, dist = geofence_flags(24.8610, 67.0000, **center)
    assert raw is False and 100 < dist < 120
    buffered, _ = geofence_flags(24.8610, 67.0000, **center, accuracy_m=50.0)
    assert buffered is True


def test_geofence_accuracy_buffer_does_not_rescue_a_clearly_outside_fix() -> None:
    # ~1.4 km out with a 50 m confidence circle stays outside.
    center = {"center_lat": 24.8600, "center_lng": 67.0000, "radius_m": 80.0}
    inside, _ = geofence_flags(24.8700, 67.0100, **center, accuracy_m=50.0)
    assert inside is False


# ── classify_day ─────────────────────────────────────────────────────────────
def test_non_working_day_is_holiday() -> None:
    roll = classify_day(day=SUNDAY, punches=[], shift=DEFAULT_SHIFT)
    assert roll.status == "holiday"
    assert roll.first_in is None and roll.last_out is None


def test_working_day_no_punch_is_absent() -> None:
    roll = classify_day(day=WORKDAY, punches=[], shift=DEFAULT_SHIFT)
    assert roll.status == "absent"
    assert roll.late is False


def test_on_time_full_day_is_present() -> None:
    roll = classify_day(
        day=WORKDAY, punches=[_in(WORKDAY, 9, 0), _out(WORKDAY, 18, 0)], shift=DEFAULT_SHIFT
    )
    assert roll.status == "present"
    assert roll.late is False
    assert roll.worked_minutes == 9 * 60


def test_clock_in_after_grace_is_late_but_present() -> None:
    # Default grace is 10 min; 09:20 is late.
    roll = classify_day(
        day=WORKDAY, punches=[_in(WORKDAY, 9, 20), _out(WORKDAY, 18, 0)], shift=DEFAULT_SHIFT
    )
    assert roll.status == "present"
    assert roll.late is True


def test_within_grace_is_not_late() -> None:
    roll = classify_day(day=WORKDAY, punches=[_in(WORKDAY, 9, 9)], shift=DEFAULT_SHIFT)
    assert roll.late is False


def test_short_day_is_half() -> None:
    # In 09:00, out 13:00 = 240 min < half of 540.
    roll = classify_day(
        day=WORKDAY, punches=[_in(WORKDAY, 9, 0), _out(WORKDAY, 13, 0)], shift=DEFAULT_SHIFT
    )
    assert roll.status == "half"
    assert roll.worked_minutes == 240


def test_outside_geofence_is_field() -> None:
    roll = classify_day(
        day=WORKDAY,
        punches=[_in(WORKDAY, 9, 0, inside=False), _out(WORKDAY, 18, 0)],
        shift=DEFAULT_SHIFT,
    )
    assert roll.status == "field"


def test_field_takes_precedence_over_half() -> None:
    # Outside fence AND short: a field tech with varied hours stays "field".
    roll = classify_day(
        day=WORKDAY,
        punches=[_in(WORKDAY, 9, 0, inside=False), _out(WORKDAY, 11, 0)],
        shift=DEFAULT_SHIFT,
    )
    assert roll.status == "field"


def test_unknown_geofence_is_not_field() -> None:
    # inside_geofence None (geofence inactive) → treated as present, not field.
    roll = classify_day(
        day=WORKDAY,
        punches=[_in(WORKDAY, 9, 0, inside=None), _out(WORKDAY, 18, 0)],
        shift=DEFAULT_SHIFT,
    )
    assert roll.status == "present"


def test_clock_in_without_out_has_no_worked_minutes() -> None:
    roll = classify_day(day=WORKDAY, punches=[_in(WORKDAY, 9, 0)], shift=DEFAULT_SHIFT)
    assert roll.status == "present"
    assert roll.worked_minutes is None
    assert roll.last_out is None


def test_earliest_in_and_latest_out_used_for_multiple_punches() -> None:
    punches = [
        _in(WORKDAY, 9, 0),
        _out(WORKDAY, 12, 0),
        _in(WORKDAY, 13, 0),
        _out(WORKDAY, 18, 30),
    ]
    roll = classify_day(day=WORKDAY, punches=punches, shift=DEFAULT_SHIFT)
    assert roll.first_in == datetime.combine(WORKDAY, time(9, 0))
    assert roll.last_out == datetime.combine(WORKDAY, time(18, 30))
    assert roll.worked_minutes == 9 * 60 + 30


def test_clock_out_before_clock_in_flags_order_and_clamps_minutes() -> None:
    # Out at 08:00 precedes in at 09:00 — nonsensical ordering. The flag fires
    # and worked-minutes clamp to 0 (payroll stays sane, the oddity surfaces).
    roll = classify_day(
        day=WORKDAY, punches=[_in(WORKDAY, 9, 0), _out(WORKDAY, 8, 0)], shift=DEFAULT_SHIFT
    )
    assert roll.order_violation is True
    assert roll.worked_minutes == 0


def test_clock_out_with_no_clock_in_flags_order_and_is_absent() -> None:
    # A lone clock-out has nothing to close: absent, but the ordering flag fires
    # so a manager sees the stray punch rather than a silent blank day.
    roll = classify_day(day=WORKDAY, punches=[_out(WORKDAY, 18, 0)], shift=DEFAULT_SHIFT)
    assert roll.status == "absent"
    assert roll.order_violation is True


def test_normal_day_has_no_order_violation() -> None:
    roll = classify_day(
        day=WORKDAY, punches=[_in(WORKDAY, 9, 0), _out(WORKDAY, 18, 0)], shift=DEFAULT_SHIFT
    )
    assert roll.order_violation is False


def test_clock_in_without_out_has_no_order_violation() -> None:
    # An open shift (in, no out) is normal, not an ordering problem.
    roll = classify_day(day=WORKDAY, punches=[_in(WORKDAY, 9, 0)], shift=DEFAULT_SHIFT)
    assert roll.order_violation is False


def test_custom_working_days_mask() -> None:
    # Mask with only Monday working; WORKDAY (Wed) becomes a holiday.
    mon_only = ShiftSpec(start_local=time(9, 0), end_local=time(18, 0), working_days="1000000")
    roll = classify_day(day=WORKDAY, punches=[], shift=mon_only)
    assert roll.status == "holiday"
