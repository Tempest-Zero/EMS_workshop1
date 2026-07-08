"""outcomes: job_outcome (the actuarial re-failure table)

Revision ID: 0028
Revises: 0027
Create Date: 2026-07-08 00:00:04.000000

W8 (spec §3.5). A brand-new empty table, so all FKs (job, refail_job,
refail_fault_code) are inline at create — no NOT VALID/VALIDATE ceremony. No
unique on job_id: a repair can be checked more than once (a 30-day manager
call, the 90-day auto-scan). The daily auto-link scan (jobs service) writes
``channel='auto_link', result='re_failed'`` rows for repeat jobs on the same
appliance unit within 90 days; the manager weekly call list stays a query.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_outcome",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("result", sa.String(16), nullable=False),
        sa.Column(
            "refail_fault_code_id",
            sa.String(64),
            sa.ForeignKey("fault_code.id"),
            nullable=True,
        ),
        sa.Column("refail_job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=True),
        sa.Column("notes", sa.String(512), nullable=True),
        sa.Column("recorded_by", sa.String(64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "channel IN ('auto_link', 'manager_call', 'whatsapp')",
            name="job_outcome_channel_check",
        ),
        sa.CheckConstraint(
            "result IN ('ok', 're_failed', 'unreachable', 'pending')",
            name="job_outcome_result_check",
        ),
    )
    op.create_index("ix_job_outcome_job_checked", "job_outcome", ["job_id", "checked_at"])


def downgrade() -> None:
    op.drop_index("ix_job_outcome_job_checked", table_name="job_outcome")
    op.drop_table("job_outcome")
