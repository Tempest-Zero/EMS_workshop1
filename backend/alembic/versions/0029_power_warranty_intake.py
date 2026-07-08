"""power & warranty & intake: job fields + CHECK evolutions + surge top-up

Revision ID: 0029
Revises: 0028
Create Date: 2026-07-08 00:00:05.000000

W9 (spec §4.1, §4.5, §4.6/§4.7). All additive: five nullable ``job`` columns
(intake channel, type reason, power protection, suspected surge, in-warranty
claimed), two new CHECKs on the nullable channel/protection columns, and two
CHECK *evolutions* — ``job_type`` gains ``pickup-delivery`` and
``job_location.kind`` gains the return + pickup-delivery transport legs. Each
evolution is drop-by-name + recreate (0009 precedent), and every existing row
already satisfies the widened set.

The surge fault codes were fully seeded in 0025; this migration re-asserts them
with ``ON CONFLICT (id) DO NOTHING`` so the intake-critical surge set is present
even if 0025's seed were ever trimmed — a guaranteed no-op on this deployment,
kept for spec fidelity (§4.6). 0025 stays authoritative for the labels.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import insert as pg_insert

# revision identifiers, used by Alembic.
revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The surge-flagged subset of the 0025 seed (id, category_id, label_en, label_ur, sort).
_SURGE_CODES = [
    ("ac_pcb_burnt", "ac", "Control board burnt", "کنٹرول بورڈ جلا ہوا", 9),
    ("ac_capacitor_fail", "ac", "Capacitor failed", "کپیسیٹر خراب", 10),
    ("ac_voltage_damage", "ac", "Voltage surge damage", "وولٹیج سے نقصان", 11),
    ("ref_relay_burnt", "refrigerator", "Start relay burnt", "اسٹارٹ ریلے جلا ہوا", 9),
    ("wm_pcb_fault", "washing_machine", "Control board fault", "کنٹرول بورڈ خراب", 9),
    ("mw_fuse_blown", "microwave", "Fuse blown", "فیوز اڑا ہوا", 6),
    ("mw_pcb_fault", "microwave", "Control board fault", "کنٹرول بورڈ خراب", 7),
    ("tv_board_fault", "tv", "Board fault", "بورڈ خراب", 4),
    ("oth_voltage_damage", "other", "Voltage surge damage", "وولٹیج سے نقصان", 3),
]

_fault_code = sa.table(
    "fault_code",
    sa.column("id", sa.String),
    sa.column("category_id", sa.String),
    sa.column("label_en", sa.String),
    sa.column("label_ur", sa.String),
    sa.column("is_surge_related", sa.Boolean),
    sa.column("sort", sa.Integer),
)


def upgrade() -> None:
    op.add_column("job", sa.Column("intake_channel", sa.String(16), nullable=True))
    op.add_column("job", sa.Column("type_reason", sa.String(256), nullable=True))
    op.add_column("job", sa.Column("power_protection", sa.String(16), nullable=True))
    op.add_column("job", sa.Column("suspected_surge", sa.Boolean(), nullable=True))
    op.add_column("job", sa.Column("in_warranty_claimed", sa.Boolean(), nullable=True))

    # New all-NULL columns → the CHECKs are trivially satisfied.
    op.create_check_constraint(
        "job_intake_channel_check",
        "job",
        "intake_channel IN ('walk_in', 'whatsapp', 'phone', 'online_form', 'email')",
    )
    op.create_check_constraint(
        "job_power_protection_check",
        "job",
        "power_protection IN ('none', 'stabilizer', 'ups', 'solar_hybrid', 'unknown')",
    )

    # CHECK evolutions (0009 precedent): widen, every existing row already fits.
    op.drop_constraint("job_type_check", "job", type_="check")
    op.create_check_constraint(
        "job_type_check", "job", "job_type IN ('carry-in', 'home-visit', 'pickup-delivery')"
    )
    op.drop_constraint("job_location_kind_check", "job_location", type_="check")
    op.create_check_constraint(
        "job_location_kind_check",
        "job_location",
        "kind IN ('depart_workshop', 'arrive_customer', 'depart_customer', "
        "'arrive_workshop', 'depart_workshop_delivery', 'arrive_customer_delivery')",
    )

    # Idempotent surge-code top-up (authoritative seed is 0025).
    op.execute(
        pg_insert(_fault_code)
        .values(
            [
                {
                    "id": fid,
                    "category_id": cat,
                    "label_en": en,
                    "label_ur": ur,
                    "is_surge_related": True,
                    "sort": sort,
                }
                for fid, cat, en, ur, sort in _SURGE_CODES
            ]
        )
        .on_conflict_do_nothing(index_elements=["id"])
    )


def downgrade() -> None:
    # Surge rows are not removed (0025 owns them). Revert schema only.
    op.drop_constraint("job_location_kind_check", "job_location", type_="check")
    op.create_check_constraint(
        "job_location_kind_check",
        "job_location",
        "kind IN ('depart_workshop', 'arrive_customer')",
    )
    op.drop_constraint("job_type_check", "job", type_="check")
    op.create_check_constraint("job_type_check", "job", "job_type IN ('carry-in', 'home-visit')")
    op.drop_constraint("job_power_protection_check", "job", type_="check")
    op.drop_constraint("job_intake_channel_check", "job", type_="check")
    op.drop_column("job", "in_warranty_claimed")
    op.drop_column("job", "suspected_surge")
    op.drop_column("job", "power_protection")
    op.drop_column("job", "type_reason")
    op.drop_column("job", "intake_channel")
