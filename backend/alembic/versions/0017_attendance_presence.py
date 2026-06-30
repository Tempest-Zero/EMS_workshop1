"""attendance presence events (passive geofence crossings)

Revision ID: 0017
Revises: 0016
Create Date: 2026-06-29 00:00:00.000000

A new ``attendance_presence_event`` table: the phone logs an ``arrive`` /
``depart`` row when it crosses the workshop geofence, independent of any
clock-in. It is the evidence behind *"I forgot to clock in but I was here"* —
a missing clock-in is ambiguous, a matching ``arrive`` is not.

Kept SEPARATE from ``attendance_event`` on purpose: the board / grid / payroll
rollups fold only ``clock_in`` / ``clock_out`` rows, and mixing crossings in
would corrupt worked-minutes. Mirrors the punch log's evidentiary columns so
the geofence verdict is computed identically.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_presence_event",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("shop_id", sa.String(length=64), nullable=False),
        sa.Column("tech_id", sa.String(length=64), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column(
            "source", sa.String(length=16), nullable=False, server_default=sa.text("'geofence'")
        ),
        sa.Column(
            "server_time",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("device_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("drift_seconds", sa.Integer(), nullable=True),
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
        sa.CheckConstraint("kind IN ('arrive', 'depart')", name="attendance_presence_kind_check"),
        sa.CheckConstraint("source IN ('geofence')", name="attendance_presence_source_check"),
        sa.UniqueConstraint("client_id", name="uq_attendance_presence_client_id"),
    )
    op.create_index(
        "ix_attendance_presence_tech_time",
        "attendance_presence_event",
        ["tech_id", "server_time"],
    )
    op.create_index(
        "ix_attendance_presence_shop_time",
        "attendance_presence_event",
        ["shop_id", "server_time"],
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_presence_shop_time", table_name="attendance_presence_event")
    op.drop_index("ix_attendance_presence_tech_time", table_name="attendance_presence_event")
    op.drop_table("attendance_presence_event")
