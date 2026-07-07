"""geography: area + curated Karachi seed, customer/job area_id FKs

Revision ID: 0022
Revises: 0021
Create Date: 2026-07-07 00:00:02.000000

W2 part 2 (spec §3.1 area). ``area`` is global (no shop_id). Seeded with a
curated list of ~20 well-known Karachi localities + 'Other' — the spec's
"mine from addresses" idea is demoted to a report suggestion in
``scripts/backfill_customers.py`` (curated beats mining for a starter set).
``power_quality`` starts 'unknown' (manager-set). The ``area_id`` columns are
added here (customer is empty; job.area_id is all-NULL) so both FKs validate in
this migration.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_area = sa.table(
    "area",
    sa.column("city", sa.String),
    sa.column("name", sa.String),
    sa.column("name_ur", sa.String),
)

# Curated Karachi localities (English + Urdu). id/power_quality/active/lat/lng
# fill from server defaults. 'Other' is the catch-all bucket.
_KARACHI_AREAS = [
    ("Gulshan-e-Iqbal", "گلشنِ اقبال"),
    ("Gulistan-e-Johar", "گلستانِ جوہر"),
    ("Defence (DHA)", "ڈیفنس"),
    ("Clifton", "کلفٹن"),
    ("Saddar", "صدر"),
    ("North Nazimabad", "نارتھ ناظم آباد"),
    ("Nazimabad", "ناظم آباد"),
    ("F.B. Area", "فیڈرل بی ایریا"),
    ("PECHS", "پی ای سی ایچ ایس"),
    ("Bahadurabad", "بہادر آباد"),
    ("Malir", "ملیر"),
    ("Korangi", "کورنگی"),
    ("Landhi", "لانڈھی"),
    ("Shah Faisal Colony", "شاہ فیصل کالونی"),
    ("Gulberg", "گلبرگ"),
    ("Liaquatabad", "لیاقت آباد"),
    ("Orangi Town", "اورنگی ٹاؤن"),
    ("New Karachi", "نیو کراچی"),
    ("SITE", "سائٹ"),
    ("Lyari", "لیاری"),
    ("Other", "دیگر"),
]


def upgrade() -> None:
    op.create_table(
        "area",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("city", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("name_ur", sa.String(128), nullable=True),
        sa.Column(
            "power_quality", sa.String(16), nullable=False, server_default=sa.text("'unknown'")
        ),
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("city", "name", name="uq_area_city_name"),
        sa.CheckConstraint(
            "power_quality IN ('good', 'moderate', 'poor', 'unknown')",
            name="area_power_quality_check",
        ),
    )
    op.bulk_insert(
        _area,
        [{"city": "Karachi", "name": name, "name_ur": name_ur} for name, name_ur in _KARACHI_AREAS],
    )

    # customer.area_id (customer table is empty) + job.area_id (all-NULL): both
    # provably clean → NOT VALID + VALIDATE in this migration.
    op.add_column("customer", sa.Column("area_id", PGUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_customer_area", "customer", "area", ["area_id"], ["id"], postgresql_not_valid=True
    )
    op.execute("ALTER TABLE customer VALIDATE CONSTRAINT fk_customer_area")

    op.add_column("job", sa.Column("area_id", PGUUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_job_area", "job", "area", ["area_id"], ["id"], postgresql_not_valid=True
    )
    op.execute("ALTER TABLE job VALIDATE CONSTRAINT fk_job_area")


def downgrade() -> None:
    op.drop_constraint("fk_job_area", "job", type_="foreignkey")
    op.drop_column("job", "area_id")
    op.drop_constraint("fk_customer_area", "customer", type_="foreignkey")
    op.drop_column("customer", "area_id")
    op.drop_table("area")
