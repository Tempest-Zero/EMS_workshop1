"""widen technician role check to allow the read-only ops_viewer role

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-30 00:00:00.000000

A third role, ``ops_viewer``, backs the standalone ops/admin console: a login
that can read production health, in-app API metrics, and the Railway/Sentry
proxies — and *nothing else*. It is gated in the service layer by
``identity.deps.require_ops_access`` (which also admits ``manager`` as a
superset), so an ops_viewer token is rejected from every jobs/attendance/payroll
endpoint exactly as a technician token is.

This migration only widens the ``technician_role_check`` constraint; no account
is seeded here (a default PIN in a migration is a standing liability). Create the
account explicitly with ``backend/scripts/create_ops_user.py`` so the PIN is the
owner's choice, never a hardcoded default.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT = "technician_role_check"
_TABLE = "technician"


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "role IN ('tech', 'manager', 'ops_viewer')",
    )


def downgrade() -> None:
    # Demote any ops_viewer rows first so recreating the narrower constraint
    # can't fail on existing data (a demote is less destructive than a delete).
    op.execute("UPDATE technician SET role = 'tech' WHERE role = 'ops_viewer'")
    op.drop_constraint(_CONSTRAINT, _TABLE, type_="check")
    op.create_check_constraint(
        _CONSTRAINT,
        _TABLE,
        "role IN ('tech', 'manager')",
    )
