"""job_location GPS punches + route

Revision ID: 0010
Revises: 0009
Create Date: 2026-06-08 10:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_location",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("is_mock", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "captured_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("device_time", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "kind IN ('depart_workshop', 'arrive_customer')", name="job_location_kind_check"
        ),
        sa.UniqueConstraint("client_id", name="uq_job_location_client"),
    )
    op.create_index("ix_job_location_job", "job_location", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_job_location_job", table_name="job_location")
    op.drop_table("job_location")
