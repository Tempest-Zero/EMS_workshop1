"""ORM model for `device_token` — the push-notification registry.

One row per (technician, device). The mobile app registers its Expo push token
on login; the jobs slice looks tokens up by ``tech_id`` to push "job assigned"
notifications. ``token`` is unique so a re-register upserts rather than dupes.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Index, String, UniqueConstraint
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class DeviceToken(Base):
    __tablename__ = "device_token"
    __table_args__ = (
        UniqueConstraint("token", name="uq_device_token_token"),
        Index("ix_device_token_tech", "tech_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    tech_id: Mapped[str] = mapped_column(String(64), nullable=False)
    token: Mapped[str] = mapped_column(String(256), nullable=False)
    platform: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'android'")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
