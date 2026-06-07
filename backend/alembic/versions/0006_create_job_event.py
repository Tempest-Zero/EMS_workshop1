"""create job_event timeline table

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-06 03:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_event",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("text", sa.String(length=1024), nullable=False),
        sa.Column("actor", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index("ix_job_event_job_time", "job_event", ["job_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_job_event_job_time", table_name="job_event")
    op.drop_table("job_event")
