"""customer_messaging: customer_message delivery bookkeeping

Revision ID: 0034
Revises: 0033
Create Date: 2026-07-08 00:00:08.000000

The WhatsApp Cloud API sender's ledger: at most one automated message per
``(job, kind)`` — the unique constraint IS the idempotency guard against
outbox replays double-sending. Brand-new empty table, so its FKs (→ shop,
→ job, → customer) are inline at create; no backfill, no NOT VALID dance.
Manual click-to-chat sends stay on the job timeline (``job_event``), not here.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customer_message",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "shop_id",
            sa.String(64),
            sa.ForeignKey("shop.id"),
            nullable=False,
            server_default=sa.text("'default'"),
        ),
        sa.Column("job_id", PGUUID(as_uuid=True), sa.ForeignKey("job.id"), nullable=False),
        sa.Column(
            "customer_id", PGUUID(as_uuid=True), sa.ForeignKey("customer.id"), nullable=True
        ),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("to_phone_e164", sa.String(20), nullable=True),
        sa.Column("body", sa.String(1024), nullable=False, server_default=sa.text("''")),
        sa.Column("template_name", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("provider_message_id", sa.String(128), nullable=True),
        sa.Column("error", sa.String(512), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("job_id", "kind", name="uq_customer_message_job_kind"),
        sa.CheckConstraint(
            "kind IN ('intake_ack', 'bill', 'ready')", name="customer_message_kind_check"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'suppressed')",
            name="customer_message_status_check",
        ),
    )
    op.create_index(
        "ix_customer_message_provider",
        "customer_message",
        ["provider_message_id"],
        postgresql_where=sa.text("provider_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_customer_message_provider", table_name="customer_message")
    op.drop_table("customer_message")
