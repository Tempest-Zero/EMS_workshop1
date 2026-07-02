"""presence.confirmed + effective_time on both attendance event tables

Revision ID: 0018
Revises: 0017
Create Date: 2026-07-02 00:00:00.000000

Two changes, both in service of trusting the device clock without being fooled
by it (D8) and confirming geofence crossings (D5):

* ``effective_time`` (NOT NULL) on BOTH ``attendance_event`` and
  ``attendance_presence_event`` — the analytical "when it happened" axis. At
  ingestion the service sets it to ``device_time`` when that timestamp is a sane
  offline capture (within ``[server_time - 24h, server_time + 2 min]``), else
  ``server_time``. Every rollup (day bucketing, worked-minutes, board/grid/
  payroll, variance) reads this, so a punch captured offline at 09:00 and synced
  at noon counts on the 09:00 day, not the sync instant.
* ``confirmed`` (nullable) on ``attendance_presence_event`` — the phone's
  crossing confirmation (True/False/NULL); backend lands the column first, the
  mobile writer follows in Step 3.

Backfill uses the same D8 rule in SQL. The literals below (2 min future
tolerance, 24 h backdate ceiling) mirror the ``core.config`` defaults
(``attendance_device_time_future_tolerance_seconds`` /
``attendance_device_time_backdate_ceiling_hours``); the migration is a
point-in-time backfill, runtime reads the config. The existing ``server_time``
indexes are kept (receipt-side audit queries still use them); the new
``(tech_id, effective_time)`` indexes serve the effective-time read paths.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("attendance_event", "attendance_presence_event")

# D8 backfill: honour device_time as the effective time only inside a sane window
# around receipt; otherwise fall back to the authoritative server_time. Literals
# mirror the core.config defaults.
_BACKFILL = """
    UPDATE {table}
    SET effective_time = CASE
        WHEN device_time IS NOT NULL
             AND device_time <= server_time + interval '2 minutes'
             AND device_time >= server_time - interval '24 hours'
        THEN device_time
        ELSE server_time
    END
"""


def upgrade() -> None:
    # 1. Add the columns nullable so the backfill can populate them.
    op.add_column(
        "attendance_event",
        sa.Column("effective_time", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "attendance_presence_event",
        sa.Column("effective_time", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "attendance_presence_event",
        sa.Column("confirmed", sa.Boolean(), nullable=True),
    )

    # 2. Backfill effective_time on both tables with the D8 rule.
    for table in _TABLES:
        op.execute(_BACKFILL.format(table=table))

    # 3. Enforce NOT NULL now that every row has a value.
    op.alter_column("attendance_event", "effective_time", nullable=False)
    op.alter_column("attendance_presence_event", "effective_time", nullable=False)

    # 4. Index the analytical axis (per-tech day / variance queries).
    op.create_index(
        "ix_attendance_event_tech_effective",
        "attendance_event",
        ["tech_id", "effective_time"],
    )
    op.create_index(
        "ix_attendance_presence_tech_effective",
        "attendance_presence_event",
        ["tech_id", "effective_time"],
    )


def downgrade() -> None:
    op.drop_index("ix_attendance_presence_tech_effective", table_name="attendance_presence_event")
    op.drop_index("ix_attendance_event_tech_effective", table_name="attendance_event")
    op.drop_column("attendance_presence_event", "confirmed")
    op.drop_column("attendance_presence_event", "effective_time")
    op.drop_column("attendance_event", "effective_time")
