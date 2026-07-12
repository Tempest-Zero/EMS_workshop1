"""password and registration

Revision ID: 0036
Revises: 0035
Create Date: 2026-07-12 00:00:00.000000

Rename pin_hash to password_hash. Add username and must_change_password.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Rename pin_hash to password_hash
    op.alter_column(
        "technician",
        "pin_hash",
        new_column_name="password_hash",
    )

    # Add username column
    op.add_column(
        "technician",
        sa.Column("username", sa.String(length=64), nullable=False, server_default=sa.text("''"))
    )
    # Backfill username with tech_id for existing seeded rows (t1..t5)
    op.execute("UPDATE technician SET username = id")
    # Add unique constraint on username
    op.create_unique_constraint("uq_technician_username", "technician", ["username"])

    # Add must_change_password column
    op.add_column(
        "technician",
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.text("false"))
    )
    # The existing manager (t1) should be forced to change password
    op.execute("UPDATE technician SET must_change_password = true WHERE id = 't1'")


def downgrade() -> None:
    op.drop_column("technician", "must_change_password")
    op.drop_constraint("uq_technician_username", "technician", type_="unique")
    op.drop_column("technician", "username")
    op.alter_column(
        "technician",
        "password_hash",
        new_column_name="pin_hash",
    )
