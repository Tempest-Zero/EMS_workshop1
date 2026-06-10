"""money integrity: labour-rate snapshot, media ownership, closed_at timestamp

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-10 00:00:00.000000

- ``job_completion.labour_rate_paisa`` — snapshotted at first submission so a
  config-rate change never silently reprices old work. Existing rows backfill
  at the rate they were actually billed with (the long-standing Rs 1200/h).
- ``job_media.created_by`` — who uploaded it; NULL on pre-existing rows (the
  delete policy grandfathers those).
- ``job.closed_at`` Date → timestamptz — orders same-day closures and allows
  duration math. Existing dates become midnight UTC of that day.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "job_completion",
        sa.Column(
            "labour_rate_paisa",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("120000"),
        ),
    )
    op.add_column("job_media", sa.Column("created_by", sa.String(length=64), nullable=True))
    op.alter_column(
        "job",
        "closed_at",
        type_=sa.DateTime(timezone=True),
        postgresql_using="closed_at::timestamptz",
    )


def downgrade() -> None:
    op.alter_column(
        "job",
        "closed_at",
        type_=sa.Date(),
        postgresql_using="closed_at::date",
    )
    op.drop_column("job_media", "created_by")
    op.drop_column("job_completion", "labour_rate_paisa")
