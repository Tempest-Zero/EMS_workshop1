"""asset layer: appliance_unit + job.appliance_unit_id

Revision ID: 0024
Revises: 0023
Create Date: 2026-07-08 00:00:00.000000

W4 (spec §3.3). The physical machine as an entity — reliability data per-unit
rather than per-job. Brand-new empty table (inline FKs), plus a nullable
``job.appliance_unit_id`` (all-NULL new column → provably clean → validated in
this migration). Rows are created by ``scripts/backfill_units.py`` post-deploy;
live intake matching ("same fridge as March?") is a named deferral.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "appliance_unit",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "shop_id",
            sa.String(64),
            sa.ForeignKey("shop.id"),
            nullable=False,
            server_default=sa.text("'default'"),
        ),
        sa.Column("customer_id", PGUUID(as_uuid=True), sa.ForeignKey("customer.id"), nullable=False),
        sa.Column(
            "category_id", sa.String(32), sa.ForeignKey("appliance_category.id"), nullable=False
        ),
        sa.Column(
            "model_id", PGUUID(as_uuid=True), sa.ForeignKey("appliance_model.id"), nullable=True
        ),
        sa.Column("brand_raw", sa.String(64), nullable=True),
        sa.Column("model_raw", sa.String(64), nullable=True),
        sa.Column("serial_number", sa.String(64), nullable=True),
        sa.Column("purchase_year", sa.Integer(), nullable=True),
        sa.Column("attrs", JSONB, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("notes", sa.String(1024), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
    )
    op.create_index("ix_appliance_unit_customer", "appliance_unit", ["customer_id"])
    op.create_index("ix_appliance_unit_model", "appliance_unit", ["model_id"])
    op.create_index(
        "ix_appliance_unit_serial",
        "appliance_unit",
        ["serial_number"],
        postgresql_where=sa.text("serial_number IS NOT NULL"),
    )

    op.add_column("job", sa.Column("appliance_unit_id", PGUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_job_appliance_unit",
        "job",
        "appliance_unit",
        ["appliance_unit_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE job VALIDATE CONSTRAINT fk_job_appliance_unit")
    op.create_index("ix_job_appliance_unit", "job", ["appliance_unit_id"])


def downgrade() -> None:
    op.drop_index("ix_job_appliance_unit", table_name="job")
    op.drop_constraint("fk_job_appliance_unit", "job", type_="foreignkey")
    op.drop_column("job", "appliance_unit_id")
    op.drop_index("ix_appliance_unit_serial", table_name="appliance_unit")
    op.drop_index("ix_appliance_unit_model", table_name="appliance_unit")
    op.drop_index("ix_appliance_unit_customer", table_name="appliance_unit")
    op.drop_table("appliance_unit")
