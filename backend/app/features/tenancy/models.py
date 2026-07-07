"""ORM models for the ``tenancy`` slice.

``Shop`` is the tenant root (spec §3.1), seeded with the ``'default'`` row by
migration 0020. ``Area`` (city localities, spec §3.1) is the geography axis of
the reliability index and the power-quality picker — global (no ``shop_id``:
areas outlive any one shop and aggregate across tenants). Seeded with curated
Karachi localities by migration 0022.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Shop(Base):
    """The tenant root. Every ``shop_id`` column FKs here."""

    __tablename__ = "shop"

    # String PK: 'default' today, future shops get slugs (mirrors technician.id).
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    address: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Replaces the per-shift timezone assumption over time.
    timezone: Mapped[str] = mapped_column(
        String(64), nullable=False, server_default=text("'Asia/Karachi'")
    )
    # Defines the unit of every ``*_minor`` money column (C3).
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default=text("'PKR'"))
    # The dispatcher's WhatsApp sending identity (§5.3).
    whatsapp_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class Area(Base):
    """A city locality. Global (no shop_id); ``power_quality`` is manager-set."""

    __tablename__ = "area"
    __table_args__ = (
        UniqueConstraint("city", "name", name="uq_area_city_name"),
        CheckConstraint(
            "power_quality IN ('good', 'moderate', 'poor', 'unknown')",
            name="area_power_quality_check",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    city: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    name_ur: Mapped[str | None] = mapped_column(String(128), nullable=True)
    power_quality: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'unknown'")
    )
    # Centroid, optional.
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
