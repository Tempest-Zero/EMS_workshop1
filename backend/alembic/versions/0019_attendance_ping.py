"""attendance on-duty pings (interval location samples while clocked in)

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-03 00:00:00.000000

A new ``attendance_ping`` table: while a tech is clocked in, the phone samples
its location on an interval (default 5 min, server-tunable) and batches the
samples up. It lets a manager see whether a tech stayed on-site through the
shift — data with context, never an auto-accusation.

``captured_at`` (the device clock at the sample) is the analytical axis so a
batch synced hours later still lands each ping on the minute it was taken;
``received_at`` is the server's receipt time (audit). No drift column — an
offline batch is expected and would false-flag every time. Idempotent on
``client_id`` (batches overlap/retry): the batch insert is
``ON CONFLICT (client_id) DO NOTHING``.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_ping",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("shop_id", sa.String(length=64), nullable=False),
        sa.Column("tech_id", sa.String(length=64), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("inside_geofence", sa.Boolean(), nullable=True),
        sa.Column("distance_m", sa.Float(), nullable=True),
        sa.Column(
            "is_mock_location",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("wifi_bssid", sa.String(length=64), nullable=True),
        sa.Column("wifi_ssid", sa.String(length=128), nullable=True),
        sa.Column("wifi_match", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("client_id", name="uq_attendance_ping_client_id"),
    )
    op.create_index(
        "ix_attendance_ping_tech_time",
        "attendance_ping",
        ["tech_id", "captured_at"],
    )
    op.create_index(
        "ix_attendance_ping_shop_time",
        "attendance_ping",
        ["shop_id", "captured_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_ping_shop_time", table_name="attendance_ping")
    op.drop_index("ix_attendance_ping_tech_time", table_name="attendance_ping")
    op.drop_table("attendance_ping")
