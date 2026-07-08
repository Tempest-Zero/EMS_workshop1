"""ORM model for the `job` table.

Conventions mirror the other slices: UUID PK with a ``gen_random_uuid()``
server default, enums stored as ``String`` + ``CheckConstraint``, tz-aware
timestamps. ``token`` is a human-facing sequential number (the ``#1052`` the
prototype shows); it's assigned from the ``job_token_seq`` Postgres sequence
(below) and kept unique. Customer/appliance fields are embedded — a customer
isn't referenced by other slices, so it doesn't need normalizing yet.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Any
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
    Sequence,
    String,
    UniqueConstraint,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# The human-facing job number (#1052…). A Postgres sequence assigns it, so two
# concurrent creates can never land on the same number and trip ``uq_job_token``.
# Bound to ``Base.metadata`` so BOTH paths that build the schema create it: the
# Alembic migration (0016) in real databases, and ``metadata.create_all`` in the
# test schema. (An earlier max+1 scheme avoided a sequence precisely because a
# migration-only object wouldn't reach create_all — binding it here removes that
# objection.) ``start=1052`` matches the prototype's first number on an empty DB.
job_token_seq = Sequence("job_token_seq", start=1052, metadata=Base.metadata)

# The global ordering key that makes job_event a transactional outbox (W7/D1).
# Bound to Base.metadata like job_token_seq so both schema paths create it
# (Alembic 0027 in real DBs, metadata.create_all in tests), and attached to
# JobEvent.seq as a client-side default so every construction site is unchanged
# and `alembic check` stays clean (the column carries no server default; the
# sequence is a separate metadata object).
job_event_seq = Sequence("job_event_seq", metadata=Base.metadata)


class JobEventKind(StrEnum):
    """Timeline entry kinds (mirror the web mock's vocabulary)."""

    CREATE = "create"
    ASSIGN = "assign"
    NOTE = "note"
    FOLLOWUP = "followup"
    STATUS = "status"
    READY = "ready"
    ESTIMATE = "estimate"
    APPROVED = "approved"
    DECLINED = "declined"
    PAYMENT = "payment"
    COMPLETE = "complete"
    BILL = "bill"
    GPS = "gps"


class JobStatus(StrEnum):
    OPEN = "open"
    WAITING = "waiting"
    READY = "ready"
    CLOSED = "closed"


class JobType(StrEnum):
    CARRY_IN = "carry-in"
    HOME_VISIT = "home-visit"
    # W9: workshop-B "we transport" pickup+delivery becomes a first-class type.
    PICKUP_DELIVERY = "pickup-delivery"


class Job(Base):
    __tablename__ = "job"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'waiting', 'ready', 'closed')", name="job_status_check"
        ),
        CheckConstraint(
            "job_type IN ('carry-in', 'home-visit', 'pickup-delivery')", name="job_type_check"
        ),
        # W9 intake fields — nullable, so NULL passes each IN check.
        CheckConstraint(
            "intake_channel IN ('walk_in', 'whatsapp', 'phone', 'online_form', 'email')",
            name="job_intake_channel_check",
        ),
        CheckConstraint(
            "power_protection IN ('none', 'stabilizer', 'ups', 'solar_hybrid', 'unknown')",
            name="job_power_protection_check",
        ),
        UniqueConstraint("token", name="uq_job_token"),
        Index("ix_job_shop_status", "shop_id", "status"),
        Index("ix_job_assigned_tech", "assigned_tech_id"),
        Index("ix_job_customer", "customer_id"),
        Index("ix_job_shop_category_status", "shop_id", "category_id", "status"),
        Index("ix_job_appliance_unit", "appliance_unit_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    token: Mapped[int] = mapped_column(Integer, nullable=False)
    shop_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("shop.id"), nullable=False, server_default=sa_text("'default'")
    )
    # ── Linked identity + geography (nullable; migrations 0021/0022) ─────────
    # Best-effort phone match at intake (0021): NULL when 0 or >1 customers match.
    customer_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=True
    )
    area_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("area.id"), nullable=True
    )
    # Appliance category (0023): dual-written at intake from appliance_type.
    category_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=True
    )
    # The physical machine (0024): set by backfill; live intake matching is a
    # named deferral (spec open decision #2).
    appliance_unit_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appliance_unit.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'open'")
    )
    job_type: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'carry-in'")
    )

    # Customer (embedded)
    customer_name: Mapped[str] = mapped_column(String(128), nullable=False)
    customer_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_address: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Appliance (embedded)
    appliance_type: Mapped[str] = mapped_column(String(64), nullable=False)
    appliance_brand: Mapped[str | None] = mapped_column(String(64), nullable=True)
    appliance_model: Mapped[str | None] = mapped_column(String(64), nullable=True)

    problem: Mapped[str] = mapped_column(String(2048), nullable=False, server_default=sa_text("''"))
    # FK → technician added NOT VALID in 0032, VALIDATE in 0033 (human data).
    assigned_tech_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("technician.id"), nullable=True
    )

    # ── Intake / power / warranty (W9; all nullable — additive) ──────────────
    # How the complaint arrived (CHECKed above).
    intake_channel: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Free-text note on why this job type was chosen (carry-in vs visit vs pickup).
    type_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Mains protection at the customer site (CHECKed above) — feeds surge analysis.
    power_protection: Mapped[str | None] = mapped_column(String(16), nullable=True)
    suspected_surge: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    in_warranty_claimed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # Scheduling / lifecycle dates (set on intake or by later status actions).
    preferred_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    time_window: Mapped[str | None] = mapped_column(String(64), nullable=True)
    waiting_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    waiting_since: Mapped[date | None] = mapped_column(Date, nullable=True)
    ready_since: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Timestamp (was a bare Date): orders same-day events and measures durations.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    abandoned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    abandon_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)

    # Bill (Module 4). Both amounts kept separately — the auto-generated
    # original and the on-site negotiated figure. Integer paisa, never floats.
    bill_original_paisa: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bill_negotiated_paisa: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    bill_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'none'")
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class JobEvent(Base):
    """Append-only timeline entry for a job (notes, follow-ups, status changes).
    The job row holds current state; this is the audit trail behind it. Since
    W7 it doubles as a transactional outbox: ``seq`` is a gap-free global
    ordering key consumers drain in order, and ``payload`` carries structured
    detail (C9 — UUIDs/slugs only, never PII)."""

    __tablename__ = "job_event"
    __table_args__ = (
        UniqueConstraint("seq", name="uq_job_event_seq"),
        Index("ix_job_event_job_time", "job_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(String(1024), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # Outbox ordering key (W7): the sequence is the client-side default, so
    # existing construction sites get a seq automatically. Unique + NOT NULL.
    seq: Mapped[int] = mapped_column(BigInteger, job_event_seq, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'{}'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class JobCompletion(Base):
    """The technician's post-job work-completion form (Module 3). One per job
    (upsert). Drives the auto-generated original bill."""

    __tablename__ = "job_completion"
    __table_args__ = (UniqueConstraint("job_id", name="uq_job_completion_job"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    time_spent_mins: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    fuel_paisa: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=sa_text("0"))
    # Snapshotted at first submission — a config-rate change never reprices old work.
    labour_rate_paisa: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default=sa_text("120000")
    )
    remarks_text: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # Loose reference to a job_media row (type=audio) — no hard FK so the voice
    # note can upload after the form submits (offline-friendly).
    remarks_audio_media_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True), nullable=True)
    # W5 tap-pickers: one primary fault + one primary action (0025). Nullable
    # forever — flag-never-block extends to data completeness; the completeness
    # score, not a constraint, drives fill-rate.
    fault_code_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("fault_code.id"), nullable=True
    )
    action_code_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("action_code.id"), nullable=True
    )
    submitted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class JobMaterial(Base):
    """A part/material line on a completion. Money is integer paisa."""

    __tablename__ = "job_material"
    __table_args__ = (
        CheckConstraint(
            "quality IS NULL OR quality IN ('genuine', 'aftermarket', 'refurb')",
            name="job_material_quality_check",
        ),
        Index("ix_job_material_completion", "completion_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    completion_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("job_completion.id"), nullable=False
    )
    # W6 (C7 raw+resolved): the DB column is ``name_raw`` — the human's free
    # text is preserved verbatim while ``part_id`` carries the resolved FK. The
    # ORM attribute stays ``name`` so the wire contract is unchanged.
    name: Mapped[str] = mapped_column("name_raw", String(128), nullable=False)
    # Resolved part identity — written by the parts picker (a named deferral);
    # NULL until then. The raw corpus above trains the future matcher.
    part_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("part.id"), nullable=True
    )
    quality: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source_market: Mapped[str | None] = mapped_column(String(64), nullable=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("1"))
    unit_paisa: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=sa_text("0"))


class JobLocationKind(StrEnum):
    """GPS punches on a job's route. The first two bound a home-visit (Phase 3);
    W9 adds the return leg + the pickup-delivery transport legs, which reuse the
    same punch rail instead of a new table."""

    DEPART_WORKSHOP = "depart_workshop"
    ARRIVE_CUSTOMER = "arrive_customer"
    DEPART_CUSTOMER = "depart_customer"
    ARRIVE_WORKSHOP = "arrive_workshop"
    DEPART_WORKSHOP_DELIVERY = "depart_workshop_delivery"
    ARRIVE_CUSTOMER_DELIVERY = "arrive_customer_delivery"


class JobLocation(Base):
    """A GPS punch on a job's route (Phase 3): leaving the workshop and arriving
    at the customer. ``client_id`` makes a punch idempotent so an offline retry
    never double-records; ``is_mock`` flags a spoofed fix for manager review.
    The straight-line route distance + fuel estimate are derived (not stored)."""

    __tablename__ = "job_location"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('depart_workshop', 'arrive_customer', 'depart_customer', "
            "'arrive_workshop', 'depart_workshop_delivery', 'arrive_customer_delivery')",
            name="job_location_kind_check",
        ),
        UniqueConstraint("client_id", name="uq_job_location_client"),
        Index("ix_job_location_job", "job_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_mock: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("false"))
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    device_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class JobPayment(Base):
    """Append-only cash/revenue ledger (Module 4). A correction VOIDs a row
    (with a reason) and re-logs — never edits or deletes. ``client_id`` makes a
    logged payment idempotent so an offline retry never double-charges."""

    __tablename__ = "job_payment"
    __table_args__ = (
        CheckConstraint("method IN ('cash', 'card', 'online')", name="job_payment_method_check"),
        UniqueConstraint("client_id", name="uq_job_payment_client"),
        Index("ix_job_payment_job", "job_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    amount_paisa: Mapped[int] = mapped_column(BigInteger, nullable=False)
    method: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'cash'")
    )
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    voided: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("false"))
    void_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)


class DispatchCursor(Base):
    """One row per outbox consumer (``whatsapp``, ``erp``, ``analytics``): the
    high-water ``seq`` it has processed from ``job_event`` (W7/D1). A dispatcher
    loop reads events ``WHERE seq > last_seq ORDER BY seq``, delivers, and
    advances ``last_seq`` — only on success, so a delivery failure is retried
    next tick rather than silently skipped. Lives with the events it consumes."""

    __tablename__ = "dispatch_cursor"

    consumer: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=sa_text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class JobOutcome(Base):
    """The actuarial table (W8, spec §3.5): did a repair actually hold? Multiple
    checks per job are allowed (a 30-day call, a 90-day auto-scan), so there is
    deliberately no unique on ``job_id``. The strongest signal is
    ``refail_job_id`` — the follow-up job on the same unit, which turns "the
    January fridge came back in March" from an inference into a row."""

    __tablename__ = "job_outcome"
    __table_args__ = (
        CheckConstraint(
            "channel IN ('auto_link', 'manager_call', 'whatsapp')",
            name="job_outcome_channel_check",
        ),
        CheckConstraint(
            "result IN ('ok', 're_failed', 'unreachable', 'pending')",
            name="job_outcome_result_check",
        ),
        Index("ix_job_outcome_job_checked", "job_id", "checked_at"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    # Set when a re-failure is reported without a follow-up job yet.
    refail_fault_code_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("fault_code.id"), nullable=True
    )
    # The follow-up job itself — the strongest re-failure signal.
    refail_job_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # tech/manager slug, or 'system' for the auto-link scan.
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
