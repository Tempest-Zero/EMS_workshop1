"""create job_media table

Revision ID: 0001
Revises:
Create Date: 2026-06-02 00:30:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_media",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("phase", sa.String(length=16), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
        sa.Column("uploaded_by", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "phase IN ('before', 'after')", name="job_media_phase_check"
        ),
        sa.CheckConstraint(
            "type IN ('video', 'photo')", name="job_media_type_check"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'uploaded')", name="job_media_status_check"
        ),
    )
    op.create_index("ix_job_media_job_id", "job_media", ["job_id"])
    op.create_index("ix_job_media_status", "job_media", ["status"])


def downgrade() -> None:
    op.drop_index("ix_job_media_status", table_name="job_media")
    op.drop_index("ix_job_media_job_id", table_name="job_media")
    op.drop_table("job_media")
