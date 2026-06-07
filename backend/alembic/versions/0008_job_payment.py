"""job_payment cash/revenue ledger

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-07 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_payment",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("amount_paisa", sa.BigInteger(), nullable=False),
        sa.Column("method", sa.String(length=16), nullable=False, server_default=sa.text("'cash'")),
        sa.Column("recorded_by", sa.String(length=64), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("voided", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("void_reason", sa.String(length=256), nullable=True),
        sa.CheckConstraint("method IN ('cash', 'card', 'online')", name="job_payment_method_check"),
        sa.UniqueConstraint("client_id", name="uq_job_payment_client"),
    )
    op.create_index("ix_job_payment_job", "job_payment", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_job_payment_job", table_name="job_payment")
    op.drop_table("job_payment")
