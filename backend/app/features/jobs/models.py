"""ORM model for the `job` table.

Conventions mirror the other slices: UUID PK with a ``gen_random_uuid()``
server default, enums stored as ``String`` + ``CheckConstraint``, tz-aware
timestamps. ``token`` is a human-facing sequential number (the ``#1052`` the
prototype shows); it's assigned by the service (max + 1) and kept unique.
Customer/appliance fields are embedded — a customer isn't referenced by other
slices, so it doesn't need normalizing yet.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


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


class JobStatus(StrEnum):
    OPEN = "open"
    WAITING = "waiting"
    READY = "ready"
    CLOSED = "closed"


class JobType(StrEnum):
    CARRY_IN = "carry-in"
    HOME_VISIT = "home-visit"


class Job(Base):
    __tablename__ = "job"
    __table_args__ = (
        CheckConstraint(
            "status IN ('open', 'waiting', 'ready', 'closed')", name="job_status_check"
        ),
        CheckConstraint("job_type IN ('carry-in', 'home-visit')", name="job_type_check"),
        UniqueConstraint("token", name="uq_job_token"),
        Index("ix_job_shop_status", "shop_id", "status"),
        Index("ix_job_assigned_tech", "assigned_tech_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    token: Mapped[int] = mapped_column(Integer, nullable=False)
    shop_id: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=sa_text("'default'")
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
    assigned_tech_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Scheduling / lifecycle dates (set on intake or by later status actions).
    preferred_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    time_window: Mapped[str | None] = mapped_column(String(64), nullable=True)
    waiting_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    waiting_since: Mapped[date | None] = mapped_column(Date, nullable=True)
    ready_since: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    abandoned: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    abandon_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class JobEvent(Base):
    """Append-only timeline entry for a job (notes, follow-ups, status changes).
    The job row holds current state; this is the audit trail behind it."""

    __tablename__ = "job_event"
    __table_args__ = (Index("ix_job_event_job_time", "job_id", "created_at"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    text: Mapped[str] = mapped_column(String(1024), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
