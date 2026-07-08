"""parts: part + part_alias + job_material resolution columns

Revision ID: 0026
Revises: 0025
Create Date: 2026-07-08 00:00:02.000000

W6 (spec §3.4 part + §4.4 job_material). Canonical part identity plus the
resolution columns on the material line. Fully additive.

Part seed provenance: the ``recommendedPart`` strings in
``src/features/troubleshooting/data/faultCodes.js`` (13 distinct parts,
canonicalized to title-case names, category-scoped) plus two cross-category
staples (capacitor, connecting wire) that carry ``category_id = NULL`` to
exercise the cross-category case the spec calls out. Prices are NOT seeded —
every ``job_material`` row is a dated, located price observation, so the price
index is a query, not a column.

``job_material`` changes (C7 raw + resolved): the ``name`` column is renamed to
``name_raw`` (the SQLAlchemy attribute stays ``name`` → zero wire churn — the
completion API is untouched). ``part_id`` (nullable FK), ``quality`` (nullable,
CHECKed), and ``source_market`` (nullable) are added all-NULL, so both the FK
and the CHECK are provably clean and validate in this migration. The parts
picker that writes these is a named deferral — the columns wait empty.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (name_canonical, category_id) — from faultCodes.js recommendedPart, plus two
# cross-category staples (category NULL).
_PARTS = [
    # ── ac ────────────────────────────────────────────────────────────────
    ("Indoor Temperature Sensor", "ac"),
    ("Run Capacitor", "ac"),
    ("Outdoor Control PCB", "ac"),
    ("Refrigerant Gas", "ac"),
    ("Condenser Fan Motor", "ac"),
    # ── washing_machine ───────────────────────────────────────────────────
    ("Shock Absorber Set", "washing_machine"),
    ("Drain Pump", "washing_machine"),
    ("Door Lock Assembly", "washing_machine"),
    ("Drive Motor", "washing_machine"),
    ("Water Level Sensor", "washing_machine"),
    # ── refrigerator ──────────────────────────────────────────────────────
    ("Thermostat", "refrigerator"),
    ("Start Relay + Overload", "refrigerator"),
    ("Fan Motor", "refrigerator"),
    # ── cross-category (NULL) ─────────────────────────────────────────────
    ("Capacitor", None),
    ("Connecting Wire", None),
]

_part = sa.table(
    "part",
    sa.column("name_canonical", sa.String),
    sa.column("category_id", sa.String),
)


def upgrade() -> None:
    op.create_table(
        "part",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("name_canonical", sa.String(128), nullable=False),
        sa.Column(
            "category_id", sa.String(32), sa.ForeignKey("appliance_category.id"), nullable=True
        ),
        sa.Column("quality", sa.String(16), nullable=True),
        sa.Column("source_market", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("name_canonical", "category_id", name="uq_part_name_category"),
        sa.CheckConstraint(
            "quality IN ('genuine', 'aftermarket', 'refurb')", name="part_quality_check"
        ),
        sa.CheckConstraint("status IN ('active', 'pending_review')", name="part_status_check"),
    )
    op.create_table(
        "part_alias",
        sa.Column(
            "id",
            PGUUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("alias_norm", sa.String(64), nullable=False),
        sa.Column("part_id", PGUUID(as_uuid=True), sa.ForeignKey("part.id"), nullable=False),
        sa.UniqueConstraint("alias_norm", "part_id", name="uq_part_alias_norm_part"),
    )
    op.create_index("ix_part_alias_norm", "part_alias", ["alias_norm"])

    op.bulk_insert(
        _part,
        [{"name_canonical": name, "category_id": cat} for name, cat in _PARTS],
    )

    # C7 raw + resolved: keep the human's free text, add the resolved FK beside
    # it. ORM attribute stays ``name`` so no wire/schema/service change.
    op.alter_column("job_material", "name", new_column_name="name_raw")
    op.add_column("job_material", sa.Column("part_id", PGUUID(as_uuid=True), nullable=True))
    op.add_column("job_material", sa.Column("quality", sa.String(16), nullable=True))
    op.add_column("job_material", sa.Column("source_market", sa.String(64), nullable=True))
    op.create_foreign_key(
        "fk_job_material_part",
        "job_material",
        "part",
        ["part_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE job_material VALIDATE CONSTRAINT fk_job_material_part")
    # New all-NULL column → the CHECK is trivially satisfied for every row.
    op.create_check_constraint(
        "job_material_quality_check",
        "job_material",
        "quality IS NULL OR quality IN ('genuine', 'aftermarket', 'refurb')",
    )


def downgrade() -> None:
    op.drop_constraint("job_material_quality_check", "job_material", type_="check")
    op.drop_constraint("fk_job_material_part", "job_material", type_="foreignkey")
    op.drop_column("job_material", "source_market")
    op.drop_column("job_material", "quality")
    op.drop_column("job_material", "part_id")
    op.alter_column("job_material", "name_raw", new_column_name="name")
    op.drop_index("ix_part_alias_norm", table_name="part_alias")
    op.drop_table("part_alias")
    op.drop_table("part")
