"""telemetry: app_event + ops_metric_rollup

Revision ID: 0031
Revises: 0030
Create Date: 2026-07-08 00:00:07.000000

W11 (spec §5.1–5.2). Two brand-new empty tables, so their FKs (app_event →
shop, app_event → device) are inline at create. ``app_event`` is Layer-1
product analytics on the outbox contract (``client_id`` unique dedupe; PII rule
enforced by review, not schema). ``ops_metric_rollup`` is the deploy-surviving
5-minute snapshot of the in-process request metrics.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_event",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column(
            "shop_id",
            sa.String(64),
            sa.ForeignKey("shop.id"),
            nullable=False,
            server_default=sa.text("'default'"),
        ),
        sa.Column("actor_kind", sa.String(16), nullable=False),
        sa.Column("actor_id", sa.String(64), nullable=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("props", JSONB, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("device_id", PGUUID(as_uuid=True), sa.ForeignKey("device.id"), nullable=True),
        sa.Column("device_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_time",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("client_id", name="uq_app_event_client"),
        sa.CheckConstraint(
            "actor_kind IN ('tech', 'manager', 'system')", name="app_event_actor_kind_check"
        ),
    )
    op.create_index("ix_app_event_shop_name_time", "app_event", ["shop_id", "name", "server_time"])
    op.create_index("ix_app_event_server_time", "app_event", ["server_time"])

    op.create_table(
        "ops_metric_rollup",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("window_seconds", sa.Integer(), nullable=False, server_default=sa.text("300")),
        sa.Column("route", sa.String(128), nullable=False),
        sa.Column("method", sa.String(8), nullable=False, server_default=sa.text("''")),
        sa.Column("count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("p50_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("p95_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("p99_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.create_index("ix_ops_metric_rollup_captured", "ops_metric_rollup", ["captured_at"])


def downgrade() -> None:
    op.drop_index("ix_ops_metric_rollup_captured", table_name="ops_metric_rollup")
    op.drop_table("ops_metric_rollup")
    op.drop_index("ix_app_event_server_time", table_name="app_event")
    op.drop_index("ix_app_event_shop_name_time", table_name="app_event")
    op.drop_table("app_event")
