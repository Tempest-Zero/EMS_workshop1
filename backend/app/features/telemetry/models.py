"""ORM models for the telemetry slice (W11, spec §5.1–5.2).

``app_event`` is Layer-1 product analytics riding the same outbox contract as
the mobile queues (``client_id`` dedupe). **PII rule (hard):** ``props`` carries
entity UUIDs and slugs only — never names, phones, addresses.

``ops_metric_rollup`` is a 5-minute snapshot of the in-process request metrics
so ops history survives a deploy (the live registry resets on restart).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import (
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


class AppEvent(Base):
    __tablename__ = "app_event"
    __table_args__ = (
        UniqueConstraint("client_id", name="uq_app_event_client"),
        CheckConstraint(
            "actor_kind IN ('tech', 'manager', 'system')", name="app_event_actor_kind_check"
        ),
        Index("ix_app_event_shop_name_time", "shop_id", "name", "server_time"),
        Index("ix_app_event_server_time", "server_time"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    # Outbox dedupe (C5): an offline retry of the same event is a no-op.
    client_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    shop_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("shop.id"), nullable=False, server_default=text("'default'")
    )
    actor_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    props: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'")
    )
    device_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("device.id"), nullable=True
    )
    device_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    server_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )


class OpsMetricRollup(Base):
    __tablename__ = "ops_metric_rollup"
    __table_args__ = (Index("ix_ops_metric_rollup_captured", "captured_at"),)

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    window_seconds: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("300"))
    # ``route='_all'`` rows carry the window totals.
    route: Mapped[str] = mapped_column(String(128), nullable=False)
    method: Mapped[str] = mapped_column(String(8), nullable=False, server_default=text("''"))
    count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    p50_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    p95_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    p99_ms: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
