"""technician security — login lockout + session revocation

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-10 00:00:00.000000

Three additive columns on ``technician``:
  * ``failed_attempts`` / ``locked_until`` — login throttle state (DB-backed so
    it survives restarts and is visible to support).
  * ``token_version`` — bumped to revoke all of a tech's live JWTs (lost-phone
    kill switch). Existing tokens carry no ``ver`` claim → treated as 0, so this
    deploy logs nobody out.

Additive only: the previous app image keeps running against this schema, so a
Railway rollback stays safe (no down-migration data loss).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "technician",
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "technician",
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "technician",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )


def downgrade() -> None:
    op.drop_column("technician", "token_version")
    op.drop_column("technician", "locked_until")
    op.drop_column("technician", "failed_attempts")
