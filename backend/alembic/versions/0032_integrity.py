"""integrity: job_media job_uuid resolve + phase/duration + tech-ref FKs (NOT VALID)

Revision ID: 0032
Revises: 0031
Create Date: 2026-07-08 00:00:08.000000

W12 (spec §4.6, §4.7, §6). The last integrity wave.

**job_media** — the loose ``job_id`` turned out to hold the job *token*
(token-keyed end-to-end: API path + R2 storage paths), NOT a UUID-string, so
the spec's literal String→UUID cast would disconnect every live media file.
Instead this adds a resolved, enforced ``job_uuid`` FK *alongside* the
operational token ``job_id`` (C7 raw + resolved): backfill token → job.id, FK
NOT VALID then VALIDATE in-migration (clean — every backfilled value references
a real job; unmatched legacy/demo rows stay NULL). The app is unchanged. Also
extends the phase CHECK (+condition, +approval) and adds ``duration_seconds``.

**tech refs** — the seven ``tech_id``/``manager_id`` columns over months of
human-written data gain FKs → technician, but **NOT VALID only**. Their
``VALIDATE`` is 0033 (a separate PR/deploy), gated on a clean prod orphan audit
(``scripts/audit_tech_orphans.py``) — because ``start.sh`` applies every pending
migration at boot, a same-deploy VALIDATE couldn't be audited between phases.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (constraint, table, local col) for the deferred-validation tech refs.
_TECH_FKS = [
    ("fk_job_assigned_tech", "job", "assigned_tech_id"),
    ("fk_attendance_event_tech", "attendance_event", "tech_id"),
    ("fk_attendance_presence_event_tech", "attendance_presence_event", "tech_id"),
    ("fk_attendance_ping_tech", "attendance_ping", "tech_id"),
    ("fk_attendance_shift_tech", "attendance_shift", "tech_id"),
    ("fk_attendance_adjustment_manager", "attendance_adjustment", "manager_id"),
    ("fk_device_token_tech", "device_token", "tech_id"),
]


def upgrade() -> None:
    # ── job_media: resolved job_uuid alongside the token job_id (C7) ──────────
    op.add_column("job_media", sa.Column("job_uuid", PGUUID(as_uuid=True), nullable=True))
    op.add_column("job_media", sa.Column("duration_seconds", sa.Integer(), nullable=True))
    # Resolve token → job.id. Rows whose token matches no job (legacy/demo) stay
    # NULL — no quarantine table needed; NULL is the honest "unlinked" marker.
    op.execute(
        """
        UPDATE job_media m
        SET job_uuid = j.id
        FROM job j
        WHERE j.token::text = m.job_id
        """
    )
    op.create_foreign_key(
        "fk_job_media_job",
        "job_media",
        "job",
        ["job_uuid"],
        ["id"],
        postgresql_not_valid=True,
    )
    # Provably clean: the backfill only set values that reference a real job.
    op.execute("ALTER TABLE job_media VALIDATE CONSTRAINT fk_job_media_job")
    op.create_index("ix_job_media_job_uuid", "job_media", ["job_uuid"])

    # phase CHECK evolution (0009 precedent): every existing row already fits.
    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_phase_check",
        "job_media",
        "phase IN ('before', 'after', 'remark', 'closing', 'condition', 'approval')",
    )

    # ── tech-ref FKs → technician, NOT VALID only (VALIDATE in 0033) ──────────
    for name, table, col in _TECH_FKS:
        op.create_foreign_key(name, table, "technician", [col], ["id"], postgresql_not_valid=True)


def downgrade() -> None:
    for name, table, _col in _TECH_FKS:
        op.drop_constraint(name, table, type_="foreignkey")
    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint(
        "job_media_phase_check",
        "job_media",
        "phase IN ('before', 'after', 'remark', 'closing')",
    )
    op.drop_index("ix_job_media_job_uuid", table_name="job_media")
    op.drop_constraint("fk_job_media_job", "job_media", type_="foreignkey")
    op.drop_column("job_media", "duration_seconds")
    op.drop_column("job_media", "job_uuid")
