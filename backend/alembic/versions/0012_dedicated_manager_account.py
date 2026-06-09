"""seed a dedicated manager account (Person A) + demote t1 to technician

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-09 00:00:00.000000

The web is the manager console. Until now the only manager identity was ``t1``
(Imran Ahmed), who is also a *technician* persona ("AC Specialist") with seeded
job/attendance history — so the manager login read as a technician. This adds a
dedicated, generic manager account (**Person A**, PIN ``1234``) and returns
``t1`` to a plain technician, so the manager picker shows one clear manager and
Imran keeps his technician identity intact.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.features.identity.security import hash_pin

# revision identifiers, used by Alembic.
revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MANAGER_ID = "m1"
_DEFAULT_PIN = "1234"

# Lightweight table handle for the data-only insert (created_at fills from its
# server default ``now()``).
_technician = sa.table(
    "technician",
    sa.column("id", sa.String),
    sa.column("name", sa.String),
    sa.column("specialty", sa.String),
    sa.column("phone", sa.String),
    sa.column("avatar", sa.String),
    sa.column("role", sa.String),
    sa.column("pin_hash", sa.String),
    sa.column("active", sa.Boolean),
)


def upgrade() -> None:
    op.bulk_insert(
        _technician,
        [
            {
                "id": _MANAGER_ID,
                "name": "Person A",
                "specialty": "Manager",
                "phone": None,
                "avatar": "bg-slate-700",
                "role": "manager",
                "pin_hash": hash_pin(_DEFAULT_PIN),
                "active": True,
            }
        ],
    )
    # t1 was doubling as the manager; return them to a plain technician so the
    # manager picker shows only Person A.
    op.execute(sa.text("UPDATE technician SET role = 'tech' WHERE id = 't1'"))


def downgrade() -> None:
    op.execute(sa.text("UPDATE technician SET role = 'manager' WHERE id = 't1'"))
    op.execute(sa.text("DELETE FROM technician WHERE id = 'm1'"))
