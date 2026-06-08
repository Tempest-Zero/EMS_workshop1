"""device_token — push notification registry

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-08 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_token",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("tech_id", sa.String(length=64), nullable=False),
        sa.Column("token", sa.String(length=256), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False, server_default=sa.text("'android'")),
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
        sa.UniqueConstraint("token", name="uq_device_token_token"),
    )
    op.create_index("ix_device_token_tech", "device_token", ["tech_id"])


def downgrade() -> None:
    op.drop_index("ix_device_token_tech", table_name="device_token")
    op.drop_table("device_token")
