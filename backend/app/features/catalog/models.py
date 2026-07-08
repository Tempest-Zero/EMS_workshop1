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
