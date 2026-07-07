"""tenancy root: shop table + shop_id FKs on the populated tables

Revision ID: 0020
Revises: 0019
Create Date: 2026-07-07 00:00:00.000000

Creates ``shop`` (the tenant root, spec §3.1) seeded with the ``'default'`` row,
adds ``technician.shop_id`` (+ ``language_pref``), and puts a ``shop_id`` FK on
every table that already carries the column.

Every existing ``shop_id`` value is ``'default'`` (verified against prod) and the
``'default'`` shop is seeded first in this migration, so each FK is provably clean
by construction. It is therefore created ``NOT VALID`` (a brief lock that enforces
on new writes immediately) and ``VALIDATE``d in the *same* migration (a
non-blocking ``SHARE UPDATE EXCLUSIVE`` scan). Human-data FKs that could hold
orphans (the tech refs) follow the two-PR pattern instead — not here.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Every table that already carries shop_id, plus technician (which gains the
# column in this migration). Each gets ``fk_{table}_shop``.
_SHOP_FK_TABLES = (
    "job",
    "attendance_event",
    "attendance_presence_event",
    "attendance_ping",
    "attendance_shift",
    "attendance_geofence",
    "payroll_export",
    "technician",
)

# Lightweight handle for the data-only seed (other columns fill from their
# server defaults).
_shop = sa.table(
    "shop",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("timezone", sa.String),
    sa.column("currency", sa.String),
    sa.column("active", sa.Boolean),
)


def upgrade() -> None:
    op.create_table(
        "shop",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("address", sa.String(512), nullable=True),
        sa.Column(
            "timezone", sa.String(64), nullable=False, server_default=sa.text("'Asia/Karachi'")
        ),
        sa.Column("currency", sa.String(3), nullable=False, server_default=sa.text("'PKR'")),
        sa.Column("whatsapp_number", sa.String(32), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # Seed the 'default' shop BEFORE any FK validates against it.
    op.bulk_insert(
        _shop,
        [
            {
                "id": "default",
                "name": "FixFlow Workshop",
                "timezone": "Asia/Karachi",
                "currency": "PKR",
                "active": True,
            }
        ],
    )

    # technician joins the shop_id family (new NOT NULL column → every existing
    # row gets 'default', clean by construction) and gains a language preference.
    op.add_column(
        "technician",
        sa.Column("shop_id", sa.String(64), nullable=False, server_default=sa.text("'default'")),
    )
    op.add_column(
        "technician",
        sa.Column("language_pref", sa.String(8), nullable=False, server_default=sa.text("'ur'")),
    )

    # Two-phase FK per table, both phases in this migration (safe: all values are
    # 'default' and the shop row exists).
    for table in _SHOP_FK_TABLES:
        fk = f"fk_{table}_shop"
        op.create_foreign_key(fk, table, "shop", ["shop_id"], ["id"], postgresql_not_valid=True)
        op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {fk}")


def downgrade() -> None:
    for table in _SHOP_FK_TABLES:
        op.drop_constraint(f"fk_{table}_shop", table, type_="foreignkey")
    op.drop_column("technician", "language_pref")
    op.drop_column("technician", "shop_id")
    op.drop_table("shop")
