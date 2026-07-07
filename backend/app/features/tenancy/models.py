"""ORM models for the ``tenancy`` slice.

``Shop`` is the tenant root (spec §3.1). It is seeded with the ``'default'`` row
by migration 0020 so every existing ``shop_id`` value validates immediately;
future shops get their own slugs. ``Area`` (city localities) joins this slice in
W2 — kept here because areas are a tenancy-adjacent axis, though global (no
``shop_id``).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, text
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
