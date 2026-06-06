"""create technician table + seed roster

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-06 00:00:00.000000

Seeds the five workshop technicians from the web mock (t1…t5). Every seeded
account shares the default PIN **1234** for first login — change PINs once a
proper account-management flow lands. ``manager`` role is given to t1 so there
is at least one manager identity; v1 does not gate on role.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.features.identity.security import hash_pin

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_PIN = "1234"

# (id, name, specialty, phone, avatar, role) — mirrors technicians.js.
_SEED = [
    ("t1", "Imran Ahmed", "AC Specialist", "0312-2345678", "bg-indigo-500", "manager"),
    ("t2", "Kashif Raza", "General Repair", "0321-3456789", "bg-emerald-600", "tech"),
    ("t3", "Tariq Mehmood", "Washing Machine", "0333-4567890", "bg-amber-500", "tech"),
    ("t4", "Asif Ali", "Refrigeration", "0300-5678901", "bg-rose-500", "tech"),
    ("t5", "Bilal Khan", "General Repair", "0345-6789012", "bg-sky-600", "tech"),
]


def upgrade() -> None:
    technician = op.create_table(
        "technician",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("specialty", sa.String(length=128), nullable=True),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("avatar", sa.String(length=32), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False, server_default=sa.text("'tech'")),
        sa.Column("pin_hash", sa.String(length=255), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("role IN ('tech', 'manager')", name="technician_role_check"),
    )

    op.bulk_insert(
        technician,
        [
            {
                "id": tech_id,
                "name": name,
                "specialty": specialty,
                "phone": phone,
                "avatar": avatar,
                "role": role,
                "pin_hash": hash_pin(_DEFAULT_PIN),
                "active": True,
            }
            for (tech_id, name, specialty, phone, avatar, role) in _SEED
        ],
    )


def downgrade() -> None:
    op.drop_table("technician")
