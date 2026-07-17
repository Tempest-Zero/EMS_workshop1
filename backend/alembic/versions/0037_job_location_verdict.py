"""jobs: ingest-time verdict columns on GPS punches

Revision ID: 0037
Revises: 0036
Create Date: 2026-07-17 12:00:00.000000

Arrival verification (flag-never-block, the attendance posture): every GPS
punch is now judged at ingest against its reference circle — the job's
customer pin for customer-side kinds (``arrive_customer`` / ``depart_customer``
/ ``arrive_customer_delivery``), the workshop geofence for workshop-side kinds
(``depart_workshop`` / ``arrive_workshop`` / ``depart_workshop_delivery``).

- ``distance_m``: metres from the reference centre. Stored whenever a
  reference existed — even for mock or coarse fixes, it's evidence.
- ``verified``: TRUE inside the radius, FALSE confidently outside, NULL
  unjudged (no reference to judge against, a mock fix, or accuracy too coarse
  to trust — mirrors attendance's ``inside_geofence`` tri-state).

Both nullable with no backfill: historical punches simply read as unjudged.
The phone's tap-time soft-block is the only gate; the server records the
verdict for manager oversight and never rejects a punch over it.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("job_location", sa.Column("distance_m", sa.Float(), nullable=True))
    op.add_column("job_location", sa.Column("verified", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("job_location", "verified")
    op.drop_column("job_location", "distance_m")
