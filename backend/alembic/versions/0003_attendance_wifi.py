"""add wifi evidence to attendance

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-04 01:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("attendance_event", sa.Column("wifi_bssid", sa.String(length=64), nullable=True))
    op.add_column("attendance_event", sa.Column("wifi_ssid", sa.String(length=128), nullable=True))
    op.add_column("attendance_event", sa.Column("wifi_match", sa.Boolean(), nullable=True))
    op.add_column(
        "attendance_geofence",
        sa.Column("wifi_bssids", sa.String(length=512), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("attendance_geofence", "wifi_bssids")
    op.drop_column("attendance_event", "wifi_match")
    op.drop_column("attendance_event", "wifi_ssid")
    op.drop_column("attendance_event", "wifi_bssid")
