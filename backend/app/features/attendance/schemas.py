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


class Board(BaseModel):
    shop_id: str
    date: date
    rows: list[BoardRow]


class GridCell(BaseModel):
    day: date
    status: DayStatus
    late: bool = False


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


class TechDays(BaseModel):
    tech_id: str
    from_date: date
    to_date: date
    days: list[TechDay]


# ── Payroll export (ERP / Sunday cycle) ───────────────────────────────────────
class PayrollDay(BaseModel):
    """One tech's attendance for one day, flattened for a payroll/ERP export."""

    tech_id: str
    date: date
    status: DayStatus
    first_in: datetime | None = None
    last_out: datetime | None = None
    worked_minutes: int | None = None


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
