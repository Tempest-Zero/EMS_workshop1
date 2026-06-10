"""payroll_export — a record per generated weekly payroll CSV

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-10 00:00:00.000000

The Sunday scheduler writes the week's attendance CSV to R2 and records it
here so the manager web can list/download past exports. The (shop, window)
uniqueness makes the scheduled job idempotent — a restart on Sunday evening
can't produce a duplicate export.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payroll_export",
        sa.Column(
            "id",
            sa.Uuid(),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("shop_id", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("from_date", sa.Date(), nullable=False),
        sa.Column("to_date", sa.Date(), nullable=False),
        sa.Column("storage_path", sa.String(length=512), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("shop_id", "from_date", "to_date", name="payroll_export_window_key"),
    )


def downgrade() -> None:
    op.drop_table("payroll_export")
