"""job completion form + bill columns

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-07 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Bill columns on the job (integer paisa).
    op.add_column("job", sa.Column("bill_original_paisa", sa.BigInteger(), nullable=True))
    op.add_column("job", sa.Column("bill_negotiated_paisa", sa.BigInteger(), nullable=True))
    op.add_column(
        "job",
        sa.Column(
            "bill_status", sa.String(length=16), nullable=False, server_default=sa.text("'none'")
        ),
    )

    op.create_table(
        "job_completion",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("time_spent_mins", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("fuel_paisa", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column("remarks_text", sa.String(length=2048), nullable=True),
        sa.Column("remarks_audio_media_id", PGUUID(as_uuid=True), nullable=True),
        sa.Column("submitted_by", sa.String(length=64), nullable=True),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("job_id", name="uq_job_completion_job"),
    )

    op.create_table(
        "job_material",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "completion_id", PGUUID(as_uuid=True), sa.ForeignKey("job_completion.id"), nullable=False
        ),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("qty", sa.Integer(), nullable=False, server_default=sa.text("1")),
        sa.Column("unit_paisa", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
    )
    op.create_index("ix_job_material_completion", "job_material", ["completion_id"])


def downgrade() -> None:
    op.drop_index("ix_job_material_completion", table_name="job_material")
    op.drop_table("job_material")
    op.drop_table("job_completion")
    op.drop_column("job", "bill_status")
    op.drop_column("job", "bill_negotiated_paisa")
    op.drop_column("job", "bill_original_paisa")
