"""Pydantic request/response models for the attendance slice.

Field names are snake_case (the web + mobile clients consume them as-is, like
the media slice). Read models set ``from_attributes`` so they build straight
from ORM rows.
"""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

PunchKind = Literal["clock_in", "clock_out"]
PresenceKind = Literal["arrive", "depart"]
PunchSource = Literal["mobile", "kiosk", "manual"]
SelfieStatus = Literal["pending", "uploaded"]
DayStatus = Literal["present", "field", "half", "absent", "holiday", "leave"]

# One shop for now; carried on every record so RLS can switch on later.
DEFAULT_SHOP_ID = "default"


# ── Mobile: punch ────────────────────────────────────────────────────────────
class PunchRequest(BaseModel):
    """Body for ``POST /api/attendance/punches``. Idempotent on ``client_id``."""

    client_id: UUID
    tech_id: str = Field(..., min_length=1, max_length=64)
    kind: PunchKind
    shop_id: str = Field(default=DEFAULT_SHOP_ID, max_length=64)
    device_time: datetime | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    is_mock_location: bool = False
    wifi_bssid: str | None = Field(default=None, max_length=64)
    wifi_ssid: str | None = Field(default=None, max_length=128)
    # If a selfie is being attached, the server mints a signed upload URL.
    selfie_filename: str | None = Field(default=None, max_length=512)
    selfie_content_type: str | None = Field(default=None, max_length=128)


class SignedSelfie(BaseModel):
    signed_url: str
    storage_path: str
    expires_in: int


class PunchResponse(BaseModel):
    """Returned on punch. ``deduped`` is true when an offline retry re-sent an
    already-recorded ``client_id`` (the call is a safe no-op)."""

    event_id: UUID
    client_id: UUID
    server_time: datetime
    inside_geofence: bool | None
    distance_m: float | None
    is_mock_location: bool
    drift_seconds: int | None
    drift_flagged: bool
    wifi_match: bool | None = None
    selfie: SignedSelfie | None = None
    deduped: bool = False


class SelfieCompleteRequest(BaseModel):
    """Body for ``POST /api/attendance/punches/{event_id}/selfie/complete``."""

    size_bytes: int | None = Field(default=None, ge=0)


class PunchItem(BaseModel):
    """Public read model of one event (selfie served as a signed URL)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    client_id: UUID
    shop_id: str
    tech_id: str
    kind: PunchKind
    source: PunchSource
    server_time: datetime
    # The analytical time the rollups bucket on (device_time when it's a sane
    # offline capture, else server_time). server_time is kept for audit.
    effective_time: datetime
    device_time: datetime | None = None
    drift_seconds: int | None = None
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    inside_geofence: bool | None = None
    distance_m: float | None = None
    is_mock_location: bool
    wifi_bssid: str | None = None
    wifi_ssid: str | None = None
    wifi_match: bool | None = None
    selfie_status: SelfieStatus
    selfie_url: str | None = None  # signed playback URL (present once uploaded)
    created_by: str | None = None
    created_at: datetime


class TodayStatus(BaseModel):
    """Tech's own live state for the clock-in screen."""

    tech_id: str
    clocked_in: bool
    last_in: datetime | None = None
    last_out: datetime | None = None


# ── Mobile: geofence presence (passive arrive/depart crossings) ───────────────
class PresenceRequest(BaseModel):
    """Body for ``POST /api/attendance/presence``. A passive geofence boundary
    crossing the phone logs on enter/leave, independent of any clock-in.
    Idempotent on ``client_id`` (the phone queues these offline, like punches),
    and carries the same GPS/wifi evidence so the fence verdict is identical."""

    client_id: UUID
    tech_id: str = Field(..., min_length=1, max_length=64)
    kind: PresenceKind
    shop_id: str = Field(default=DEFAULT_SHOP_ID, max_length=64)
    device_time: datetime | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    is_mock_location: bool = False
    wifi_bssid: str | None = Field(default=None, max_length=64)
    wifi_ssid: str | None = Field(default=None, max_length=128)
    # The phone's crossing confirmation (D5): True = a fresh fix agreed with the
    # OS geofence event, False = contradicted (still logged as evidence), None =
    # unconfirmable / pre-feature. Persisted as-is; never rejected.
    confirmed: bool | None = None


class PresenceResponse(BaseModel):
    """Returned on a logged crossing. ``deduped`` is true when an offline retry
    re-sent an already-recorded ``client_id`` (the call is a safe no-op)."""

    event_id: UUID
    client_id: UUID
    server_time: datetime
    kind: PresenceKind
    inside_geofence: bool | None = None
    distance_m: float | None = None
    deduped: bool = False


class PresenceItem(BaseModel):
    """Public read model of one crossing (for the manager's tech-detail timeline)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    client_id: UUID
    shop_id: str
    tech_id: str
    kind: PresenceKind
    source: str
    server_time: datetime
    effective_time: datetime
    device_time: datetime | None = None
    drift_seconds: int | None = None
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    inside_geofence: bool | None = None
    distance_m: float | None = None
    is_mock_location: bool
    wifi_bssid: str | None = None
    wifi_ssid: str | None = None
    wifi_match: bool | None = None
    # Crossing confirmation (D5): True/False/None — see the model.
    confirmed: bool | None = None
    created_at: datetime


class ActiveGeofence(BaseModel):
    """The minimal geofence shape the technician app needs to register OS-level
    geofencing. Readable by ANY authenticated principal (unlike the manager
    config endpoint), but exposes only the circle — no wifi BSSID list."""

    name: str
    center_lat: float
    center_lng: float
    radius_m: int
    is_active: bool
    # The on-duty ping cadence (minutes), server-tunable without an app release.
    # The phone caches this and paces its sampling to it; the same value drives
    # the server's missing-ping (2×) math, so client and server agree.
    ping_interval_minutes: int


# ── Mobile: on-duty pings (interval location samples while clocked in) ────────
class PingRequest(BaseModel):
    """One on-duty location sample. ``captured_at`` is the device clock at the
    sample (the analytical axis — no drift is computed, an offline batch is
    expected). Idempotent on ``client_id`` like a punch/crossing."""

    client_id: UUID
    tech_id: str = Field(..., min_length=1, max_length=64)
    shop_id: str = Field(default=DEFAULT_SHOP_ID, max_length=64)
    captured_at: datetime
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    accuracy_m: float | None = Field(default=None, ge=0)
    is_mock_location: bool = False
    wifi_bssid: str | None = Field(default=None, max_length=64)
    wifi_ssid: str | None = Field(default=None, max_length=128)


class PingBatch(BaseModel):
    """Body for ``POST /api/attendance/pings`` — up to 100 samples per call. The
    phone drains its queue in batches this size; over 100 is a 422."""

    pings: list[PingRequest] = Field(..., max_length=100)


class PingBatchResponse(BaseModel):
    """``accepted`` = newly stored, ``deduped`` = already-seen client_ids skipped
    (safe no-ops), ``rejected`` = captured_at outside the trust window — not
    stored, and the client should still prune them (the batch is a success).
    ``ping_interval_minutes`` echoes the server cadence so the phone can re-pace
    without a separate fetch."""

    accepted: int
    deduped: int
    rejected: int = 0
    ping_interval_minutes: int


class AwayInterval(BaseModel):
    """A run within the clocked window where the tech's on-duty pings put them
    OUTSIDE the fence (``outside``) or gave no usable data (``no_data``). The
    manager-meaningful shape of the ping data — the raw per-ping list is never
    exposed. Rendered neutrally on ``field`` days (offsite is the job there)."""

    start: datetime  # naive shop-local
    end: datetime
    kind: Literal["outside", "no_data"]


# ── Manager: board / grid / detail ───────────────────────────────────────────
class BoardRow(BaseModel):
    tech_id: str
    status: DayStatus
    late: bool
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int | None = None
    wifi_match: bool | None = None
    flagged_mock: bool = False
    flagged_outside: bool = False
    flagged_drift: bool = False
    # Evidence gaps: no usable GPS fix / selfie never uploaded (mobile punches).
    flagged_no_location: bool = False
    flagged_no_selfie: bool = False
    # The phone entered the workshop fence (a geofence `arrive` was logged) but
    # the tech never clocked in — the "forgot vs absent" signal at a glance.
    flagged_arrived_not_clocked_in: bool = False
    # Clock-out before clock-in (or a clock-out with no clock-in). Worked
    # minutes are clamped to 0; this surfaces the punch oddity to check.
    flagged_order: bool = False


class Board(BaseModel):
    shop_id: str
    date: date
    rows: list[BoardRow]


class GridCell(BaseModel):
    day: date
    status: DayStatus
    late: bool = False
    # Same evidence flags as the board — the grid is what a month's pay review
    # actually looks at, so the signals must reach it too.
    flagged_mock: bool = False
    flagged_outside: bool = False
    flagged_drift: bool = False
    flagged_no_location: bool = False
    flagged_no_selfie: bool = False
    flagged_order: bool = False


class GridRow(BaseModel):
    tech_id: str
    present: int
    working: int
    cells: list[GridCell]


class Grid(BaseModel):
    shop_id: str
    month: str  # "YYYY-MM"
    rows: list[GridRow]


class TechDay(BaseModel):
    day: date
    status: DayStatus
    late: bool
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int | None = None
    punches: list[PunchItem]
    # Passive geofence crossings for the day + the "forgot vs absent" signal:
    # the phone entered the fence (an `arrive` exists) but the tech never
    # clocked in. The manager's evidence for adjudicating a missing punch.
    presence: list[PresenceItem] = []
    arrived_not_clocked_in: bool = False
    flagged_order: bool = False
    # On-duty ping breakdown over the clocked window (null when there's no closed
    # window or no pings). The raw ping list is deliberately NOT exposed — the
    # away intervals are the manager-meaningful shape.
    inside_minutes: int | None = None
    outside_minutes: int | None = None
    no_data_minutes: int | None = None
    coverage_pct: float | None = None
    away_intervals: list[AwayInterval] = []


class TechDays(BaseModel):
    tech_id: str
    from_date: date
    to_date: date
    days: list[TechDay]


# ── Payroll export (ERP / Sunday cycle) ───────────────────────────────────────
class PayrollDay(BaseModel):
    """One tech's attendance for one day, flattened for a payroll/ERP export.
    Carries the evidence flags: the export is the document pay is decided
    from, so the anti-cheat signals must survive into it."""

    tech_id: str
    date: date
    status: DayStatus
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int | None = None
    flagged_mock: bool = False
    flagged_outside: bool = False
    flagged_drift: bool = False
    flagged_no_location: bool = False
    flagged_no_selfie: bool = False
    flagged_order: bool = False


class PayrollExport(BaseModel):
    shop_id: str
    from_date: date
    to_date: date
    rows: list[PayrollDay]


class PayrollExportFile(BaseModel):
    """A generated weekly CSV on record (bytes in R2; URL is a signed GET)."""

    id: UUID
    from_date: date
    to_date: date
    row_count: int
    created_at: datetime
    download_url: str


# ── Manager: variance report (system evidence vs manual punches) ─────────────
class VarianceRow(BaseModel):
    """One tech-day: the system's evidence (geofence crossings; pings from
    Step 7) lined up against the manual punches, with the deltas a manager
    reviews. All times/deltas are on ``effective_time`` (so sync latency never
    shows up as attendance variance); a delta is null when either side is
    missing. Ping fields are null until Step 7. Flags are read-time annotations
    that never block."""

    tech_id: str
    date: date
    status: DayStatus
    # Arrival: first geofence `arrive` vs first clock-in (naive shop-local).
    first_arrive: datetime | None = None
    first_clock_in: datetime | None = None
    # clock_in − arrive, minutes. +ve = clocked in after the phone arrived.
    delta_in_minutes: int | None = None
    # Departure: last geofence `depart` vs last clock-out.
    last_depart: datetime | None = None
    last_clock_out: datetime | None = None
    # depart − clock_out, minutes. +ve = phone left after clocking out.
    delta_out_minutes: int | None = None
    clocked_minutes: int | None = None
    # Ping summary — null until Step 7 (on-duty pings).
    inside_minutes: int | None = None
    outside_minutes: int | None = None
    no_data_minutes: int | None = None
    coverage_pct: float | None = None
    away_intervals: list[AwayInterval] = []
    flagged_arrived_not_clocked_in: bool = False
    flagged_order: bool = False
    flagged_away: bool = False


class VarianceReport(BaseModel):
    shop_id: str
    from_date: date
    to_date: date
    rows: list[VarianceRow]


# ── Selfie evidence reconciliation ───────────────────────────────────────────
class SelfieGap(BaseModel):
    """A mobile punch whose selfie never reached storage after the grace
    window — either no photo was attached (camera denied / cancelled) or the
    upload never completed. The punch stays valid; the gap is the manager's
    signal (mirrors the jobs closing-video evidence-gaps pattern)."""

    event_id: UUID
    tech_id: str
    kind: PunchKind
    server_time: datetime
    selfie_attached: bool  # True = promised but bytes never arrived; False = no photo at all


# ── Manager: config (shift / geofence) ───────────────────────────────────────
class Shift(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    shop_id: str
    tech_id: str
    start_local: time
    end_local: time
    working_days: str = Field(..., min_length=7, max_length=7)
    grace_minutes: int = Field(..., ge=0)
    timezone: str


class ShiftUpdate(BaseModel):
    start_local: time
    end_local: time
    working_days: str = Field(..., min_length=7, max_length=7, pattern=r"^[01]{7}$")
    grace_minutes: int = Field(default=10, ge=0)
    timezone: str = Field(default="Asia/Karachi", max_length=64)


class Geofence(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    shop_id: str
    name: str
    center_lat: float
    center_lng: float
    radius_m: int
    is_active: bool
    wifi_bssids: str | None = None


class GeofenceUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    center_lat: float = Field(..., ge=-90, le=90)
    center_lng: float = Field(..., ge=-180, le=180)
    radius_m: int = Field(..., gt=0)
    is_active: bool = True
    wifi_bssids: str | None = Field(default=None, max_length=512)


# ── Manager: audited adjustment ──────────────────────────────────────────────
class AdjustmentRequest(BaseModel):
    """A manager correction. Creates a NEW event (``source='manual'``) plus an
    audit row linking it to the original — the log is never edited."""

    tech_id: str = Field(..., min_length=1, max_length=64)
    kind: PunchKind
    server_time: datetime
    reason: str = Field(..., min_length=1, max_length=512)
    manager_id: str = Field(..., min_length=1, max_length=128)
    shop_id: str = Field(default=DEFAULT_SHOP_ID, max_length=64)
    original_event_id: UUID | None = None


class AdjustmentResponse(BaseModel):
    adjustment_id: UUID
    new_event_id: UUID
    original_event_id: UUID | None = None


class AdjustmentItem(BaseModel):
    """An entry in the manager-correction audit trail (joined to its new event)."""

    id: UUID
    tech_id: str
    kind: PunchKind
    server_time: datetime
    original_event_id: UUID | None = None
    reason: str
    manager_id: str
    created_at: datetime
