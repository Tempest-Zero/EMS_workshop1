"""extend job_media: audio type + remark/closing phases

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-07 11:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_phase_check",
        "job_media",
        "phase IN ('before', 'after', 'remark', 'closing')",
    )
    op.drop_constraint("job_media_type_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_type_check",
        "job_media",
        "type IN ('video', 'photo', 'audio')",
    )


def downgrade() -> None:
    op.drop_constraint("job_media_type_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_type_check", "job_media", "type IN ('video', 'photo')"
    )
    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_phase_check", "job_media", "phase IN ('before', 'after')"
    )
