"""ORM models for the ``catalog`` slice (spec §3.4).

Category is a String PK (legible in every analytics query, C1). Brand/model are
UUIDs with canonical names + alias tables. New brands/models a technician adds
land ``pending_review``; a manager approves them (and approving a misspelling
creates an alias, so the mistake auto-resolves thereafter).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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

_REVIEW_STATUS = "status IN ('active', 'pending_review')"


class ApplianceCategory(Base):
    __tablename__ = "appliance_category"

    # String PK: 'ac', 'refrigerator', … — legible in analytics (C1).
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name_en: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name_ur: Mapped[str | None] = mapped_column(String(64), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class ApplianceBrand(Base):
    __tablename__ = "appliance_brand"
    __table_args__ = (
        UniqueConstraint("name_canonical", name="uq_appliance_brand_name"),
        CheckConstraint(_REVIEW_STATUS, name="appliance_brand_status_check"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name_canonical: Mapped[str] = mapped_column(String(64), nullable=False)
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class ApplianceModel(Base):
    __tablename__ = "appliance_model"
    __table_args__ = (
        UniqueConstraint("brand_id", "model_norm", name="uq_appliance_model_brand_norm"),
        CheckConstraint(_REVIEW_STATUS, name="appliance_model_status_check"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    brand_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appliance_brand.id"), nullable=False
    )
    category_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=False
    )
    # Normalized (upper, trimmed).
    model_norm: Mapped[str] = mapped_column(String(64), nullable=False)
    launch_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Per-category specs (tonnage, cu-ft, inverter y/n — C9).
    attrs: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class BrandAlias(Base):
    __tablename__ = "brand_alias"
    __table_args__ = (
        UniqueConstraint("alias_norm", "brand_id", name="uq_brand_alias_norm_brand"),
        Index("ix_brand_alias_norm", "alias_norm"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    alias_norm: Mapped[str] = mapped_column(String(64), nullable=False)
    brand_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appliance_brand.id"), nullable=False
    )


class ModelAlias(Base):
    __tablename__ = "model_alias"
    __table_args__ = (
        UniqueConstraint("alias_norm", "model_id", name="uq_model_alias_norm_model"),
        Index("ix_model_alias_norm", "alias_norm"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    alias_norm: Mapped[str] = mapped_column(String(64), nullable=False)
    model_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("appliance_model.id"), nullable=False
    )


class FaultCode(Base):
    """Diagnosis vocabulary, per category (W5). String PK slugs keep the
    reliability index legible (``ac / ac_gas_low / ac_gas_recharge``, C1).
    ``active=false`` retires a code — never delete: history references it."""

    __tablename__ = "fault_code"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=False
    )
    label_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    label_ur: Mapped[str | None] = mapped_column(String(128), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # §4.6 — surge codes are just flagged members of the same vocabulary.
    is_surge_related: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class ActionCode(Base):
    """Fix vocabulary, per category (W5) — same shape as fault_code minus the
    surge flag."""

    __tablename__ = "action_code"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    category_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=False
    )
    label_en: Mapped[str | None] = mapped_column(String(128), nullable=True)
    label_ur: Mapped[str | None] = mapped_column(String(128), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sort: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


_PART_QUALITY = "quality IN ('genuine', 'aftermarket', 'refurb')"


class Part(Base):
    """Canonical part identity (W6). Prices are NOT stored here — every
    ``job_material`` row is a dated, located price observation, so the price
    index is a query, not a column. ``category_id`` NULL = cross-category
    (capacitors, wire). ``quality``/``source_market`` are the default
    expectation; per-line truth lives on ``job_material``."""

    __tablename__ = "part"
    __table_args__ = (
        UniqueConstraint("name_canonical", "category_id", name="uq_part_name_category"),
        CheckConstraint(_PART_QUALITY, name="part_quality_check"),
        CheckConstraint(_REVIEW_STATUS, name="part_status_check"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name_canonical: Mapped[str] = mapped_column(String(128), nullable=False)
    category_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("appliance_category.id"), nullable=True
    )
    quality: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source_market: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'active'"))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))


class PartAlias(Base):
    """Alias → canonical part (W6). Same shape as brand/model aliases: a manager
    approving a misspelling creates one, so the mistake auto-resolves after."""

    __tablename__ = "part_alias"
    __table_args__ = (
        UniqueConstraint("alias_norm", "part_id", name="uq_part_alias_norm_part"),
        Index("ix_part_alias_norm", "alias_norm"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    alias_norm: Mapped[str] = mapped_column(String(64), nullable=False)
    part_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("part.id"), nullable=False
    )
