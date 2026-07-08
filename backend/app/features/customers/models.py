"""ORM models for the ``customers`` slice (spec §3.2 + §3.3).

``customer`` is the repeat-customer identity; ``customer_phone`` is the
E.164-normalized intake match key (indexed but **not** globally unique —
households share numbers, so matching is a ranked suggestion, never an
auto-merge); ``customer_consent_event`` is the append-only consent log (the
current-state columns on ``customer`` answer "may we?", this table proves it).
``appliance_unit`` (W4) is the physical machine as an entity — reliability data
per-unit rather than per-job.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

_SOURCES = "'walk_in', 'whatsapp', 'phone', 'online_form', 'email', 'referral', 'backfill'"


class Customer(Base):
    __tablename__ = "customer"
    __table_args__ = (
        CheckConstraint(f"source IN ({_SOURCES})", name="customer_source_check"),
        Index("ix_customer_shop", "shop_id"),
        Index("ix_customer_merged_into", "merged_into_customer_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("shop.id"), nullable=False, server_default=text("'default'")
    )
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # FK added in migration 0022 (after the area table exists).
    area_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("area.id"), nullable=True
    )
    # Current address; a job keeps its own snapshot (C8).
    address_default: Mapped[str | None] = mapped_column(String(512), nullable=True)
    source: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'walk_in'")
    )
    # Denormalized current consent state; truth lives in customer_consent_event.
    whatsapp_opt_in_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    consent_contact_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Dedupe merges point loser → winner; reads follow the pointer, no row deletion.
    merged_into_customer_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    )


class CustomerPhone(Base):
    __tablename__ = "customer_phone"
    __table_args__ = (
        UniqueConstraint("customer_id", "phone_e164", name="uq_customer_phone_customer_phone"),
        # Non-unique on purpose: households share numbers; match is a suggestion.
        Index("ix_customer_phone_phone", "phone_e164"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=False
    )
    phone_e164: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))


class ApplianceUnit(Base):
    """The physical machine (spec §3.3): repairs over time on *the same
    compressor*. Created/matched at intake, enriched with serial at arrival.
    ``serial_number`` is indexed but NOT unique (typos, shared plates) — dedupe
    is a review queue, never a constraint."""

    __tablename__ = "appliance_unit"
    __table_args__ = (
        Index("ix_appliance_unit_customer", "customer_id"),
        Index("ix_appliance_unit_model", "model_id"),
        Index(
            "ix_appliance_unit_serial",
            "serial_number",
            postgresql_where=text("serial_number IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("shop.id"), nullable=False, server_default=text("'default'")
    )
    # Units move on customer merge.
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=False
    )
    category_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=False
    )
    # Resolved when known; brand_raw/model_raw keep what was typed/said (C7).
    model_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appliance_model.id"), nullable=True
    )
    brand_raw: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_raw: Mapped[str | None] = mapped_column(String(64), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # §4.7 warranty economics.
    purchase_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Tonnage, capacity, unit-specific facts (C9).
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    notes: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
        onupdate=text("now()"),
    )


class CustomerConsentEvent(Base):
    __tablename__ = "customer_consent_event"
    __table_args__ = (
        CheckConstraint("kind IN ('given', 'withdrawn')", name="customer_consent_event_kind_check"),
        CheckConstraint(
            "scope IN ('contact', 'whatsapp', 'analytics')",
            name="customer_consent_event_scope_check",
        ),
        CheckConstraint(
            "channel IN ('verbal', 'form', 'whatsapp', 'backfill')",
            name="customer_consent_event_channel_check",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    customer_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
