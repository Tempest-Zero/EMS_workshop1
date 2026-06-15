"""job number from a Postgres sequence (no more max+1 race)

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-15 00:00:00.000000

``job.token`` (the human-facing #1052 number) was assigned by the service as
``max(token) + 1``, which two concurrent creates can read identically and then
collide on ``uq_job_token``. Replace it with a dedicated sequence whose
``nextval`` is atomic. Seed the sequence above the highest token already in the
table so live job numbers never repeat.

The sequence is also declared on the ORM metadata (``jobs.models.job_token_seq``)
so the test schema built via ``metadata.create_all`` carries it too.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS job_token_seq")
    # Move the sequence to the current high-water mark. setval(n) marks the
    # sequence "called", so the next nextval is n+1. On an empty table the
    # COALESCE floor of 1051 makes the first number 1052 (the prototype start).
    op.execute(
        "SELECT setval('job_token_seq', "
        "GREATEST((SELECT COALESCE(MAX(token), 1051) FROM job), 1051))"
    )


def downgrade() -> None:
    op.execute("DROP SEQUENCE IF EXISTS job_token_seq")
