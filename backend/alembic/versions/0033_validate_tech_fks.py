"""validate the tech-ref FKs deferred from 0032

Revision ID: 0033
Revises: 0032
Create Date: 2026-07-08 00:00:09.000000

W13 (spec §6), the two-phase FK completion. 0032 added the seven
``tech_id``/``manager_id`` → technician FKs as NOT VALID (enforced on new writes
immediately, but existing rows unscanned). This migration runs the ``VALIDATE
CONSTRAINT`` scan — a SHARE UPDATE EXCLUSIVE lock that doesn't block reads or
writes — turning them into fully-enforced constraints.

It ships as a SEPARATE deploy from 0032 on purpose: ``start.sh`` runs every
pending migration at boot, so validating in the same deploy as the NOT VALID add
would leave no window to audit orphans between the two phases. The precondition
for opening this PR is ``scripts/audit_tech_orphans.py`` reading 0 orphans
against prod (it does).

``downgrade`` is a no-op: un-validating a constraint is not a meaningful rollback
(the constraint still exists from 0032), and there is nothing to undo — the scan
only changed the ``convalidated`` flag. Rolling back the FKs themselves is 0032's
``downgrade``.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (constraint, table) — the seven NOT VALID FKs added in 0032.
_TECH_FKS = [
    ("fk_job_assigned_tech", "job"),
    ("fk_attendance_event_tech", "attendance_event"),
    ("fk_attendance_presence_event_tech", "attendance_presence_event"),
    ("fk_attendance_ping_tech", "attendance_ping"),
    ("fk_attendance_shift_tech", "attendance_shift"),
    ("fk_attendance_adjustment_manager", "attendance_adjustment"),
    ("fk_device_token_tech", "device_token"),
]


def upgrade() -> None:
    for name, table in _TECH_FKS:
        op.execute(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")


def downgrade() -> None:
    # No-op: the constraints already exist (added in 0032); VALIDATE only flipped
    # convalidated. There is nothing to un-validate. See 0032 to drop the FKs.
    pass
