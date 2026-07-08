"""catalog: appliance category/brand/model + aliases, job.category_id backfill

Revision ID: 0023
Revises: 0022
Create Date: 2026-07-07 00:00:03.000000

W3 (spec §3.4). Five brand-new tables (inline FKs). Seeds 9 categories + 8
canonical brands. Adds ``job.category_id`` and backfills it from existing
``appliance_type`` via a deterministic exact map (mirrors
``app/features/jobs/catalog_map.py``; the migration hardcodes it because a
migration is a frozen snapshot). Categories are seeded *before* the backfill and
FK, so every backfilled value references a real row → the FK validates in this
migration. Unmatched appliance_types stay NULL.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (id, name_en, name_ur, icon, sort)
_CATEGORIES = [
    ("ac", "Air Conditioner", "ایئر کنڈیشنر", "ac", 1),
    ("refrigerator", "Refrigerator", "ریفریجریٹر", "refrigerator", 2),
    ("deep_freezer", "Deep Freezer", "ڈیپ فریزر", "deep_freezer", 3),
    ("washing_machine", "Washing Machine", "واشنگ مشین", "washing_machine", 4),
    ("water_dispenser", "Water Dispenser", "واٹر ڈسپینسر", "water_dispenser", 5),
    ("microwave", "Microwave Oven", "مائیکرو ویو", "microwave", 6),
    ("oven", "Oven", "اوون", "oven", 7),
    ("tv", "Television", "ٹی وی", "tv", 8),
    ("other", "Other", "دیگر", "other", 9),
]

# (name_canonical, country)
_BRANDS = [
    ("Dawlance", "Pakistan"),
    ("Haier", "China"),
    ("PEL", "Pakistan"),
    ("Orient", "Pakistan"),
    ("Waves", "Pakistan"),
    ("Samsung", "South Korea"),
    ("Gree", "China"),
    ("Kenwood", "Pakistan"),
]

# Mirrors app/features/jobs/catalog_map.py (kept in sync by hand — a migration is
# a frozen snapshot, so it hardcodes rather than imports the runtime dict).
_TYPE_TO_CATEGORY = {
    "ac": "ac",
    "split ac": "ac",
    "window ac": "ac",
    "air conditioner": "ac",
    "refrigerator": "refrigerator",
    "fridge": "refrigerator",
    "deep freezer": "deep_freezer",
    "freezer": "deep_freezer",
    "washing machine": "washing_machine",
    "washer": "washing_machine",
    "water dispenser": "water_dispenser",
    "microwave": "microwave",
    "microwave oven": "microwave",
    "oven": "oven",
    "tv": "tv",
    "television": "tv",
    "led tv": "tv",
    "other": "other",
}

_category = sa.table(
    "appliance_category",
    sa.column("id", sa.String),
    sa.column("name_en", sa.String),
    sa.column("name_ur", sa.String),
    sa.column("icon", sa.String),
    sa.column("sort", sa.Integer),
)
_brand = sa.table(
    "appliance_brand",
    sa.column("name_canonical", sa.String),
    sa.column("country", sa.String),
)


def upgrade() -> None:
    op.create_table(
        "appliance_category",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name_en", sa.String(64), nullable=True),
        sa.Column("name_ur", sa.String(64), nullable=True),
        sa.Column("icon", sa.String(64), nullable=True),
        sa.Column("sort", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_table(
        "appliance_brand",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("name_canonical", sa.String(64), nullable=False),
        sa.Column("country", sa.String(64), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.UniqueConstraint("name_canonical", name="uq_appliance_brand_name"),
        sa.CheckConstraint(
            "status IN ('active', 'pending_review')", name="appliance_brand_status_check"
        ),
    )
    op.create_table(
        "appliance_model",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column(
            "brand_id", PGUUID(as_uuid=True), sa.ForeignKey("appliance_brand.id"), nullable=False
        ),
        sa.Column(
            "category_id", sa.String(32), sa.ForeignKey("appliance_category.id"), nullable=False
        ),
        sa.Column("model_norm", sa.String(64), nullable=False),
        sa.Column("launch_year", sa.Integer(), nullable=True),
        sa.Column("attrs", JSONB, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.String(16), nullable=False, server_default=sa.text("'active'")),
        sa.Column("created_by", sa.String(64), nullable=True),
        sa.UniqueConstraint("brand_id", "model_norm", name="uq_appliance_model_brand_norm"),
        sa.CheckConstraint(
            "status IN ('active', 'pending_review')", name="appliance_model_status_check"
        ),
    )
    op.create_table(
        "brand_alias",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("alias_norm", sa.String(64), nullable=False),
        sa.Column(
            "brand_id", PGUUID(as_uuid=True), sa.ForeignKey("appliance_brand.id"), nullable=False
        ),
        sa.UniqueConstraint("alias_norm", "brand_id", name="uq_brand_alias_norm_brand"),
    )
    op.create_index("ix_brand_alias_norm", "brand_alias", ["alias_norm"])
    op.create_table(
        "model_alias",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("alias_norm", sa.String(64), nullable=False),
        sa.Column(
            "model_id", PGUUID(as_uuid=True), sa.ForeignKey("appliance_model.id"), nullable=False
        ),
        sa.UniqueConstraint("alias_norm", "model_id", name="uq_model_alias_norm_model"),
    )
    op.create_index("ix_model_alias_norm", "model_alias", ["alias_norm"])

    # Seed categories BEFORE the job.category_id backfill + FK validate.
    op.bulk_insert(
        _category,
        [
            {"id": cid, "name_en": en, "name_ur": ur, "icon": icon, "sort": sort}
            for cid, en, ur, icon, sort in _CATEGORIES
        ],
    )
    op.bulk_insert(
        _brand,
        [{"name_canonical": name, "country": country} for name, country in _BRANDS],
    )

    op.add_column("job", sa.Column("category_id", sa.String(32), nullable=True))
    # Deterministic exact backfill (case-insensitive on the trimmed type).
    for atype, cat in _TYPE_TO_CATEGORY.items():
        op.execute(
            sa.text(
                "UPDATE job SET category_id = :cat "
                "WHERE lower(trim(appliance_type)) = :atype AND category_id IS NULL"
            ).bindparams(cat=cat, atype=atype)
        )
    op.create_foreign_key(
        "fk_job_category",
        "job",
        "appliance_category",
        ["category_id"],
        ["id"],
        postgresql_not_valid=True,
    )
    op.execute("ALTER TABLE job VALIDATE CONSTRAINT fk_job_category")
    op.create_index("ix_job_shop_category_status", "job", ["shop_id", "category_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_job_shop_category_status", table_name="job")
    op.drop_constraint("fk_job_category", "job", type_="foreignkey")
    op.drop_column("job", "category_id")
    op.drop_index("ix_model_alias_norm", table_name="model_alias")
    op.drop_table("model_alias")
    op.drop_index("ix_brand_alias_norm", table_name="brand_alias")
    op.drop_table("brand_alias")
    op.drop_table("appliance_model")
    op.drop_table("appliance_brand")
    op.drop_table("appliance_category")
