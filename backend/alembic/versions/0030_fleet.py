"""fleet: device registry + device_token.device_id

Revision ID: 0030
Revises: 0029
Create Date: 2026-07-08 00:00:06.000000

W10 (spec §3.6, §4.7). Brand-new ``device`` table (the fleet registry) with an
inline ``tech_id`` FK — the table starts empty and technician predates it, so
deferring the FK would be pure ceremony. ``device_token`` gains a nullable
``device_id`` FK to it; the column is all-NULL on arrival, so the FK is provably
clean and validates in this migration. (``device_token.tech_id`` gains its FK in
0032, with the other tech refs over months of human data.)
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("installation_id", sa.String(64), nullable=False),
        sa.Column("tech_id", sa.String(64), sa.ForeignKey("technician.id"), nullable=True),
        sa.Column("platform", sa.String(16), nullable=False, server_default=sa.text("'android'")),
        sa.Column("os_version", sa.String(32), nullable=True),
        sa.Column("app_version", sa.String(32), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("installation_id", name="uq_device_installation"),
    )

    op.add_column("device_token", sa.Column("device_id", PGUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_device_token_device",
        "device_token",
        "device",
        ["device_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE device_token VALIDATE CONSTRAINT fk_device_token_device")


def downgrade() -> None:
    op.drop_constraint("fk_device_token_device", "device_token", type_="foreignkey")
    op.drop_column("device_token", "device_id")
    op.drop_table("device")
