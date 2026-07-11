"""jobs: job_travel_sample breadcrumbs + completion fuel provenance

Revision ID: 0035
Revises: 0034
Create Date: 2026-07-11 00:00:09.000000

Two additive pieces of the fuel/distance overhaul:

1. ``job_travel_sample`` — bulk GPS breadcrumbs sampled during a job's travel
   legs (the attendance-ping pattern on the jobs slice). Trusted samples
   between the depart/arrive punches path-sum to the actual driven distance,
   upgrading the fuel line from the straight-line × circuity estimate.
   Brand-new empty table, so its FKs (→ job, → technician) are inline at
   create; no backfill, no NOT VALID dance.

2. ``job_completion`` fuel provenance — nullable ``fuel_distance_m`` +
   ``fuel_basis`` (how the billed fuel was produced; NULL on historical rows
   reads as implicitly manual) and a NOT NULL ``fuel_rate_paisa_per_km``
   snapshot (server_default = today's Rs 20/km) so auto-derived fuel is never
   silently repriced by a later config change — same contract as
   ``labour_rate_paisa``. All additive with defaults: safe on a populated
   table, nothing to validate.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "job_travel_sample",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column("client_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("leg", sa.String(16), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("accuracy_m", sa.Float(), nullable=True),
        sa.Column("is_mock", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("recorded_by", sa.String(64), sa.ForeignKey("technician.id"), nullable=True),
        sa.CheckConstraint(
            "leg IN ('outbound', 'return', 'delivery')",
            name="job_travel_sample_leg_check",
        ),
        sa.UniqueConstraint("client_id", name="uq_job_travel_sample_client_id"),
    )
    op.create_index(
        "ix_job_travel_sample_job_time",
        "job_travel_sample",
        ["job_id", "captured_at"],
    )

    op.add_column("job_completion", sa.Column("fuel_distance_m", sa.Float(), nullable=True))
    op.add_column("job_completion", sa.Column("fuel_basis", sa.String(16), nullable=True))
    op.create_check_constraint(
        "job_completion_fuel_basis_check",
        "job_completion",
        "fuel_basis IS NULL OR fuel_basis IN ('manual', 'estimate', 'breadcrumbs')",
    )
    op.add_column(
        "job_completion",
        sa.Column(
            "fuel_rate_paisa_per_km",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("2000"),
        ),
    )


def downgrade() -> None:
    op.drop_column("job_completion", "fuel_rate_paisa_per_km")
    op.drop_constraint("job_completion_fuel_basis_check", "job_completion", type_="check")
    op.drop_column("job_completion", "fuel_basis")
    op.drop_column("job_completion", "fuel_distance_m")
    op.drop_index("ix_job_travel_sample_job_time", table_name="job_travel_sample")
    op.drop_table("job_travel_sample")
