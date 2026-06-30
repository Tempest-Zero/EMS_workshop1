"""ORM models for the attendance slice.

Four tables, all stamped with ``shop_id`` (RLS-ready; one shop for now):

* ``attendance_event``       — append-only punch log; the source of truth.
* ``attendance_shift``       — one shift per tech; gives "late"/"absent" meaning.
* ``attendance_geofence``    — workshop circle(s); used to FLAG, never to block.
* ``attendance_adjustment``  — audit trail linking a manager correction to the
  new event it creates (the log itself is never edited).

Conventions mirror the media slice (`features/media/models.py`): UUID PKs with a
``gen_random_uuid()`` server default, enums stored as ``String`` + a
``CheckConstraint``, and timezone-aware timestamps with ``now()`` defaults.
"""

from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, time
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Time,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class PunchKind(StrEnum):
    CLOCK_IN = "clock_in"
    CLOCK_OUT = "clock_out"


class PresenceKind(StrEnum):
    ARRIVE = "arrive"
    DEPART = "depart"


class PunchSource(StrEnum):
    MOBILE = "mobile"
    KIOSK = "kiosk"
    MANUAL = "manual"


class SelfieStatus(StrEnum):
    PENDING = "pending"
    UPLOADED = "uploaded"


class AttendanceEvent(Base):
    """One punch. Insert-only: the evidentiary fields (time, gps, flags) are
    never mutated. The single post-insert transition is the selfie pointer
    going ``pending`` → ``uploaded`` (the photo is best-effort and may land
    after the punch syncs); that is finalizing an attachment, not editing the
    punch. Manager corrections are *new* events, never edits."""

    __tablename__ = "attendance_event"
    __table_args__ = (
        CheckConstraint("kind IN ('clock_in', 'clock_out')", name="attendance_event_kind_check"),
        CheckConstraint(
            "source IN ('mobile', 'kiosk', 'manual')", name="attendance_event_source_check"
        ),
        CheckConstraint(
            "selfie_status IN ('pending', 'uploaded')",
            name="attendance_event_selfie_status_check",
        ),
        UniqueConstraint("client_id", name="uq_attendance_event_client_id"),
        Index("ix_attendance_event_tech_time", "tech_id", "server_time"),
        Index("ix_attendance_event_shop_time", "shop_id", "server_time"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # Client-generated UUID: the offline idempotency / dedup key. A re-synced
    # punch carries the same client_id, so the server treats it as a no-op.
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    shop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tech_id: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'mobile'"))

    # WHEN — server_time is authoritative; device_time + drift catch tampering.
    server_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    device_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    drift_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # WHERE — captured + flagged, never used to block.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    inside_geofence: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_mock_location: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # WHERE (corroboration) — workshop WiFi is harder to spoof than GPS and works
    # indoors where GPS degrades. `wifi_match` = the BSSID is a configured AP.
    wifi_bssid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wifi_ssid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    wifi_match: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # WHO — selfie reference (bytes live in R2; DB holds the key only).
    selfie_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    selfie_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    selfie_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    created_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class AttendancePresenceEvent(Base):
    """A passive geofence boundary crossing logged by the technician's phone
    when it ENTERS or LEAVES the workshop circle — independent of whether the
    tech clocks in.

    This is the anti-fraud backbone for *"I forgot to clock in but I was
    here"*: a `clock_in` going missing is ambiguous (forgot vs. never came); a
    matching `arrive` presence event makes the phone's actual presence visible
    to the manager. It is **evidence, never a punch** — kept in a separate
    table on purpose so the worked-minutes / board / payroll math (which folds
    only `attendance_event` clock_in/clock_out rows) is never polluted by it.

    Insert-only, like the punch log. Idempotent on ``client_id`` (the phone
    queues these offline and retries), and stamped with the same evidentiary
    fields a punch carries (gps + accuracy + mock flag + wifi + drift) so the
    geofence verdict is computed identically."""

    __tablename__ = "attendance_presence_event"
    __table_args__ = (
        CheckConstraint("kind IN ('arrive', 'depart')", name="attendance_presence_kind_check"),
        CheckConstraint("source IN ('geofence')", name="attendance_presence_source_check"),
        UniqueConstraint("client_id", name="uq_attendance_presence_client_id"),
        Index("ix_attendance_presence_tech_time", "tech_id", "server_time"),
        Index("ix_attendance_presence_shop_time", "shop_id", "server_time"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # Client-generated UUID: the offline idempotency / dedup key, exactly like a
    # punch — a re-synced crossing carries the same client_id and is a no-op.
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    shop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tech_id: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'geofence'")
    )

    # WHEN — server_time is authoritative; device_time + drift catch tampering.
    server_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    device_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    drift_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # WHERE — the geofence verdict, captured + flagged exactly like a punch.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    inside_geofence: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    distance_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_mock_location: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    wifi_bssid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    wifi_ssid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    wifi_match: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class AttendanceShift(Base):
    """One shift per tech. ``working_days`` is a 7-char Mon→Sun bitmask
    (``"1111110"`` = Mon–Sat). The service falls back to a default shift when a
    tech has no row, so seeding is optional."""

    __tablename__ = "attendance_shift"
    __table_args__ = (UniqueConstraint("shop_id", "tech_id", name="uq_attendance_shift_shop_tech"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tech_id: Mapped[str] = mapped_column(String(64), nullable=False)
    start_local: Mapped[time] = mapped_column(Time, nullable=False)
    end_local: Mapped[time] = mapped_column(Time, nullable=False)
    working_days: Mapped[str] = mapped_column(
        String(7), nullable=False, server_default=text("'1111110'")
    )
    grace_minutes: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("10"))
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'Asia/Karachi'")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class AttendanceGeofence(Base):
    """A workshop circle. Used to FLAG punches inside/outside, never to block."""

    __tablename__ = "attendance_geofence"
    __table_args__ = (Index("ix_attendance_geofence_shop_id", "shop_id"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(
        String(128), nullable=False, server_default=text("'Workshop'")
    )
    center_lat: Mapped[float] = mapped_column(Float, nullable=False)
    center_lng: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("150"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    # CSV of the workshop's known AP MAC addresses (BSSIDs) used for wifi_match.
    wifi_bssids: Mapped[str | None] = mapped_column(String(512), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class AttendanceAdjustment(Base):
    """Audit trail: a manager correction creates a new ``attendance_event``
    (``source='manual'``) and this row linking it to the original event."""

    __tablename__ = "attendance_adjustment"
    __table_args__ = (Index("ix_attendance_adjustment_new_event", "new_event_id"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    original_event_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("attendance_event.id"), nullable=True
    )
    new_event_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("attendance_event.id"), nullable=False
    )
    manager_id: Mapped[str] = mapped_column(String(128), nullable=False)
    reason: Mapped[str] = mapped_column(String(512), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class PayrollExportRecord(Base):
    """One generated weekly payroll CSV (the bytes live in R2 at
    ``storage_path``). Written by the Sunday scheduler or an on-demand run;
    the (shop, window) unique key makes re-runs no-ops."""

    __tablename__ = "payroll_export"
    __table_args__ = (
        UniqueConstraint("shop_id", "from_date", "to_date", name="payroll_export_window_key"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(String(64), nullable=False, server_default="default")
    from_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    to_date: Mapped[date_type] = mapped_column(Date, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
