"""ORM models for the notifications/fleet slice.

``device_token`` is the push registry (one row per push token). ``device`` (W10)
is the fleet registry — one row per physical phone, keyed by its Expo
installation id — the rollout gate + hardware-onboarding anchor + per-device
telemetry key. A token belongs to a device (``device_token.device_id``).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Device(Base):
    """A physical phone in the fleet (W10, spec §3.6). Keyed by its Expo
    ``installation_id`` so re-registers upsert. ``tech_id`` is bound at first
    login (inline FK — the table starts empty, technician predates it);
    ``app_version`` drives the fleet-rollout gate; ``last_seen_at`` is a
    heartbeat refreshed on registration."""

    __tablename__ = "device"
    __table_args__ = (UniqueConstraint("installation_id", name="uq_device_installation"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    installation_id: Mapped[str] = mapped_column(String(64), nullable=False)
    tech_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("technician.id"), nullable=True
    )
    platform: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'android'")
    )
    os_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )


class DeviceToken(Base):
    __tablename__ = "device_token"
    __table_args__ = (
        UniqueConstraint("token", name="uq_device_token_token"),
        Index("ix_device_token_tech", "tech_id"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    # FK → technician added NOT VALID in 0032, VALIDATE in 0033 (human data).
    tech_id: Mapped[str] = mapped_column(String(64), ForeignKey("technician.id"), nullable=False)
    token: Mapped[str] = mapped_column(String(256), nullable=False)
    platform: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=sa_text("'android'")
    )
    # The physical device this token belongs to (W10). Its tech_id FK waits for
    # 0032 (over months of human data); device_id is a fresh all-NULL column.
    device_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("device.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=sa_text("now()")
    )
