"""customer identity: customer + customer_phone + customer_consent_event

Revision ID: 0021
Revises: 0020
Create Date: 2026-07-07 00:00:01.000000

W2 part 1 (spec §3.2). Three brand-new empty tables (inline FKs — nothing to
validate) plus a nullable ``job.customer_id`` FK. The job column is all-NULL on
creation, so its FK is provably clean and validated in the same migration.
Geography (``area`` + the ``area_id`` columns) lands in 0022.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SOURCES = "'walk_in', 'whatsapp', 'phone', 'online_form', 'email', 'referral', 'backfill'"


def upgrade() -> None:
    op.create_table(
        "customer",
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
        sa.Column("full_name", sa.String(128), nullable=False),
        sa.Column("address_default", sa.String(512), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default=sa.text("'walk_in'")),
        sa.Column("whatsapp_opt_in_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consent_contact_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "merged_into_customer_id",
            PGUUID(as_uuid=True),
            sa.ForeignKey("customer.id"),
            nullable=True,
        ),
        sa.Column("notes", sa.String(1024), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint(f"source IN ({_SOURCES})", name="customer_source_check"),
    )
    op.create_index("ix_customer_shop", "customer", ["shop_id"])
    op.create_index("ix_customer_merged_into", "customer", ["merged_into_customer_id"])

    op.create_table(
        "customer_phone",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "customer_id", PGUUID(as_uuid=True), sa.ForeignKey("customer.id"), nullable=False
        ),
        sa.Column("phone_e164", sa.String(20), nullable=False),
        sa.Column("label", sa.String(32), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.UniqueConstraint("customer_id", "phone_e164", name="uq_customer_phone_customer_phone"),
    )
    # Non-unique on purpose: households share numbers; matching is a suggestion.
    op.create_index("ix_customer_phone_phone", "customer_phone", ["phone_e164"])

    op.create_table(
        "customer_consent_event",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "customer_id", PGUUID(as_uuid=True), sa.ForeignKey("customer.id"), nullable=False
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("scope", sa.String(16), nullable=False),
        sa.Column("channel", sa.String(16), nullable=False),
        sa.Column("recorded_by", sa.String(64), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint("kind IN ('given', 'withdrawn')", name="customer_consent_event_kind_check"),
        sa.CheckConstraint(
            "scope IN ('contact', 'whatsapp', 'analytics')",
            name="customer_consent_event_scope_check",
        ),
        sa.CheckConstraint(
            "channel IN ('verbal', 'form', 'whatsapp', 'backfill')",
            name="customer_consent_event_channel_check",
        ),
    )

    # job.customer_id: all-NULL new column → provably clean → same-migration VALIDATE.
    op.add_column("job", sa.Column("customer_id", PGUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_job_customer", "job", "customer", ["customer_id"], ["id"], postgresql_not_valid=True
    )
    op.execute("ALTER TABLE job VALIDATE CONSTRAINT fk_job_customer")
    op.create_index("ix_job_customer", "job", ["customer_id"])


def downgrade() -> None:
    op.drop_index("ix_job_customer", table_name="job")
    op.drop_constraint("fk_job_customer", "job", type_="foreignkey")
    op.drop_column("job", "customer_id")
    op.drop_table("customer_consent_event")
    op.drop_index("ix_customer_phone_phone", table_name="customer_phone")
    op.drop_table("customer_phone")
    op.drop_index("ix_customer_merged_into", table_name="customer")
    op.drop_index("ix_customer_shop", table_name="customer")
    op.drop_table("customer")
