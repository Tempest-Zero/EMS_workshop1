"""events-as-outbox: job_event.payload/seq backfill + dispatch_cursor

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-08 00:00:03.000000

W7 (spec §4.2 + §5.2/D1). Turns ``job_event`` into a transactional outbox and
adds the per-consumer cursor that drains it.

The delicate step is ``seq``. It is added NULL (no physical-order default),
then backfilled by ``row_number() OVER (ORDER BY created_at, id)`` — a
deterministic order (rehearsed read-only against prod: 56 rows number to a
gap-free 1..56, unique, no created_at ties). ``job_event_seq`` is created and
``setval`` to the max backfilled value (0016 precedent) so the first live
insert continues the run without colliding; only THEN is ``seq`` set NOT NULL
and made UNIQUE. The ORM attaches ``job_event_seq`` to ``JobEvent.seq`` as a
client-side default (verified to emit no server DEFAULT → ``alembic check``
clean), so every construction site keeps working unchanged.

``payload`` is additive (JSONB, C9 — UUIDs/slugs only, never PII).

Downgrade is schema-only: it drops ``seq``/``payload``/``dispatch_cursor`` and
the sequence. The backfilled ordering is not preserved (a re-upgrade re-derives
it from ``created_at``), which is correct for an append-only log.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. payload — additive, safe default.
    op.add_column(
        "job_event",
        sa.Column("payload", JSONB, nullable=False, server_default=sa.text("'{}'")),
    )

    # 2. seq — nullable first so the backfill (not a physical default) sets it.
    op.add_column("job_event", sa.Column("seq", sa.BigInteger(), nullable=True))
    op.execute("CREATE SEQUENCE IF NOT EXISTS job_event_seq")

    # 3. deterministic backfill in (created_at, id) order.
    op.execute(
        """
        UPDATE job_event je
        SET seq = numbered.rn
        FROM (
            SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
            FROM job_event
        ) AS numbered
        WHERE je.id = numbered.id
        """
    )

    # 4. advance the sequence past the backfilled max (only when rows exist, so
    #    an empty DB leaves the sequence fresh → first insert is seq=1).
    op.execute(
        """
        SELECT setval('job_event_seq', s.max_seq)
        FROM (SELECT MAX(seq) AS max_seq FROM job_event) AS s
        WHERE s.max_seq IS NOT NULL
        """
    )

    # 5. now every row has a seq → lock it down.
    op.alter_column("job_event", "seq", nullable=False)
    op.create_unique_constraint("uq_job_event_seq", "job_event", ["seq"])

    # 6. the per-consumer cursor that makes job_event a real outbox.
    op.create_table(
        "dispatch_cursor",
        sa.Column("consumer", sa.String(32), primary_key=True),
        sa.Column("last_seq", sa.BigInteger(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("dispatch_cursor")
    op.drop_constraint("uq_job_event_seq", "job_event", type_="unique")
    op.drop_column("job_event", "seq")
    op.execute("DROP SEQUENCE IF EXISTS job_event_seq")
    op.drop_column("job_event", "payload")
