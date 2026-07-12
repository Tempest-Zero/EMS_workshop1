"""jobs+media: customer home pin, idempotent create, intake voice-note phase

Revision ID: 0036
Revises: 0035
Create Date: 2026-07-11 12:00:00.000000

Three additive enablers for the new mobile intake/travel flows:

1. ``job.customer_lat`` / ``job.customer_lng`` — the customer's home pin,
   dropped on a map at intake for home-visit jobs. The travel screen renders
   it and hands off to the Maps app for navigation. Nullable: carry-in jobs
   and every historical row simply have no pin. The free-text
   ``customer_address`` stays untouched beside it (C7 raw+resolved).

2. ``job.client_id`` — intake idempotency. The phone's outbox retries a queued
   create with the same client-minted UUID; the unique constraint turns a
   replay into a dedupe instead of a duplicate job (the payments/punches
   contract, applied to creation). Nullable + unique: Postgres permits many
   NULLs, so web-created jobs (no client_id) are unaffected.

3. ``job_media`` phase check gains ``'intake'`` — the intake problem voice
   note. The DB check already anticipated ``condition``/``approval`` (0026);
   only this one value is new. Like ``remark``, intake/approval audio is
   referenced from its owning form, not the evidence gallery.

All additive with NULL defaults — safe on a populated table, nothing to
validate.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_PHASES_OLD = "('before', 'after', 'remark', 'closing', 'condition', 'approval')"
_PHASES_NEW = "('before', 'after', 'remark', 'closing', 'condition', 'approval', 'intake')"


def upgrade() -> None:
    op.add_column("job", sa.Column("customer_lat", sa.Float(), nullable=True))
    op.add_column("job", sa.Column("customer_lng", sa.Float(), nullable=True))
    op.add_column("job", sa.Column("client_id", PGUUID(as_uuid=True), nullable=True))
    op.create_unique_constraint("uq_job_client_id", "job", ["client_id"])

    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint("job_media_phase_check", "job_media", f"phase IN {_PHASES_NEW}")


def downgrade() -> None:
    op.drop_constraint("job_media_phase_check", "job_media", type_="check")
    op.create_check_constraint("job_media_phase_check", "job_media", f"phase IN {_PHASES_OLD}")

    op.drop_constraint("uq_job_client_id", "job", type_="unique")
    op.drop_column("job", "client_id")
    op.drop_column("job", "customer_lng")
    op.drop_column("job", "customer_lat")
