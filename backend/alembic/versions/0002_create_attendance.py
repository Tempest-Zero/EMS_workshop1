"""create attendance tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-04 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attendance_event",
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
        sa.Column("source", sa.String(length=16), nullable=False, server_default=sa.text("'mobile'")),
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
        sa.Column("selfie_path", sa.String(length=1024), nullable=True),
        sa.Column(
            "selfie_status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("selfie_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("created_by", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("kind IN ('clock_in', 'clock_out')", name="attendance_event_kind_check"),
        sa.CheckConstraint(
            "source IN ('mobile', 'kiosk', 'manual')", name="attendance_event_source_check"
        ),
        sa.CheckConstraint(
            "selfie_status IN ('pending', 'uploaded')",
            name="attendance_event_selfie_status_check",
        ),
        sa.UniqueConstraint("client_id", name="uq_attendance_event_client_id"),
    )
    op.create_index(
        "ix_attendance_event_tech_time", "attendance_event", ["tech_id", "server_time"]
    )
    op.create_index(
        "ix_attendance_event_shop_time", "attendance_event", ["shop_id", "server_time"]
    )

    op.create_table(
        "attendance_shift",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("shop_id", sa.String(length=64), nullable=False),
        sa.Column("tech_id", sa.String(length=64), nullable=False),
        sa.Column("start_local", sa.Time(), nullable=False),
        sa.Column("end_local", sa.Time(), nullable=False),
        sa.Column(
            "working_days", sa.String(length=7), nullable=False, server_default=sa.text("'1111110'")
        ),
        sa.Column("grace_minutes", sa.Integer(), nullable=False, server_default=sa.text("10")),
        sa.Column(
            "timezone",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'Asia/Karachi'"),
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("shop_id", "tech_id", name="uq_attendance_shift_shop_tech"),
    )

    op.create_table(
        "attendance_geofence",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("shop_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False, server_default=sa.text("'Workshop'")),
        sa.Column("center_lat", sa.Float(), nullable=False),
        sa.Column("center_lng", sa.Float(), nullable=False),
        sa.Column("radius_m", sa.Integer(), nullable=False, server_default=sa.text("150")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index("ix_attendance_geofence_shop_id", "attendance_geofence", ["shop_id"])

    op.create_table(
        "attendance_adjustment",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "original_event_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("attendance_event.id"),
            nullable=True,
        ),
        sa.Column(
            "new_event_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("attendance_event.id"),
            nullable=False,
        ),
        sa.Column("manager_id", sa.String(length=128), nullable=False),
        sa.Column("reason", sa.String(length=512), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_attendance_adjustment_new_event", "attendance_adjustment", ["new_event_id"]
    )

    # Seed one INACTIVE placeholder geofence so the manager has a row to edit
    # with the real workshop coordinates. While inactive, geofence flagging is
    # off (inside_geofence stays NULL) — nothing is mislabelled "field".
    op.execute(
        """
        INSERT INTO attendance_geofence
            (shop_id, name, center_lat, center_lng, radius_m, is_active)
        VALUES
            ('default', 'Workshop (PLACEHOLDER — set real coords)', 0, 0, 150, false)
        """
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_adjustment_new_event", table_name="attendance_adjustment")
    op.drop_table("attendance_adjustment")
    op.drop_index("ix_attendance_geofence_shop_id", table_name="attendance_geofence")
    op.drop_table("attendance_geofence")
    op.drop_table("attendance_shift")
    op.drop_index("ix_attendance_event_shop_time", table_name="attendance_event")
    op.drop_index("ix_attendance_event_tech_time", table_name="attendance_event")
    op.drop_table("attendance_event")
