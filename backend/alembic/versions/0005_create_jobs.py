"""create job table + seed the prototype jobs

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-06 02:00:00.000000

Seeds the 17 jobs from the web mock (tokens 1035–1051, late-May 2026) so the
manager board is populated the moment the UI flips from mock to API. Only the
*core* fields are seeded — estimates, payments, notes, and the timeline arrive
with their own slices (J2/J4).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, date, datetime

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PGUUID

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _dt(year: int, month: int, day: int) -> datetime:
    return datetime(year, month, day, 10, 0, tzinfo=UTC)


def _row(
    token: int,
    status: str,
    job_type: str,
    name: str,
    phone: str,
    address: str,
    atype: str,
    brand: str,
    model: str,
    problem: str,
    tech: str,
    created: datetime,
    *,
    preferred: date | None = None,
    window: str | None = None,
    waiting_reason: str | None = None,
    waiting_since: date | None = None,
    ready_since: date | None = None,
    closed_at: date | None = None,
) -> dict[str, object]:
    return {
        "token": token,
        "status": status,
        "job_type": job_type,
        "customer_name": name,
        "customer_phone": phone,
        "customer_address": address,
        "appliance_type": atype,
        "appliance_brand": brand,
        "appliance_model": model,
        "problem": problem,
        "assigned_tech_id": tech,
        "preferred_date": preferred,
        "time_window": window,
        "waiting_reason": waiting_reason,
        "waiting_since": waiting_since,
        "ready_since": ready_since,
        "closed_at": closed_at,
        "created_at": created,
    }


_SEED: list[dict[str, object]] = [
    # ── closed ──
    _row(1035, "closed", "carry-in", "Abdul Rehman", "0300-2211009",
         "House 12-C, Block 6, PECHS, Karachi", "Split AC", "Gree", "GS-12CITH",
         "Not cooling, blowing warm air even on lowest temp.", "t1", _dt(2026, 5, 18),
         closed_at=date(2026, 5, 22)),
    _row(1036, "closed", "carry-in", "Saima Khan", "0321-7788123",
         "Flat 4, Saima Heights, Gulshan-e-Iqbal, Karachi", "Washing Machine", "Samsung", "WA80H4",
         "Drum not spinning, loud grinding noise during wash.", "t2", _dt(2026, 5, 17),
         closed_at=date(2026, 5, 21)),
    _row(1037, "closed", "carry-in", "Muhammad Aslam", "0333-5566778",
         "A-45, Bahadurabad, Karachi", "Refrigerator", "Dawlance", "9170WB",
         "Freezer not freezing, fridge compartment only slightly cool.", "t4", _dt(2026, 5, 19),
         closed_at=date(2026, 5, 24)),
    _row(1038, "closed", "carry-in", "Nadia Hussain", "0345-1239876",
         "House 78, DHA Phase 5, Karachi", "Microwave", "Haier", "HMN-720",
         "Turns on and runs but food stays cold, no heating.", "t2", _dt(2026, 5, 20),
         closed_at=date(2026, 5, 25)),
    # ── ready ──
    _row(1039, "ready", "carry-in", "Imtiaz Begum", "0312-4455667",
         "Apartment 9, North Nazimabad Block H, Karachi", "Split AC", "Haier", "HSU-12",
         "AC trips the breaker as soon as it starts.", "t1", _dt(2026, 5, 20),
         ready_since=date(2026, 5, 21)),
    _row(1040, "ready", "carry-in", "Kamran Shah", "0300-9988776",
         "Plot 23, Gulistan-e-Johar, Karachi", "Refrigerator", "PEL", "PRINV-2200",
         "Compressor runs continuously but fridge is not cooling.", "t4", _dt(2026, 5, 23),
         ready_since=date(2026, 5, 26)),
    _row(1041, "ready", "carry-in", "Rabia Sultan", "0321-2345111",
         "House 5-B, Clifton Block 2, Karachi", "Washing Machine", "LG", "T2108",
         "Won't drain, water stays in the drum after cycle.", "t2", _dt(2026, 5, 27),
         ready_since=date(2026, 5, 29)),
    # ── waiting ──
    _row(1042, "waiting", "carry-in", "Faisal Mahmood", "0333-1112223",
         "B-101, Gulshan-e-Iqbal Block 13, Karachi", "Split AC", "Dawlance", "Inverter 1.5T",
         "Inverter AC shows E6, outdoor unit not starting.", "t1", _dt(2026, 5, 17),
         waiting_since=date(2026, 5, 19),
         waiting_reason="Needs part: Outdoor control PCB (on order from supplier)"),
    _row(1043, "waiting", "home-visit", "Hina Tariq", "0345-7654321",
         "House 22, KDA Scheme 1, Karachi", "Refrigerator", "Haier", "HRF-368",
         "No cooling at all, compressor very hot to touch.", "t4", _dt(2026, 5, 22),
         preferred=date(2026, 5, 23), waiting_since=date(2026, 5, 25),
         waiting_reason="Awaiting customer approval on estimate"),
    _row(1044, "waiting", "carry-in", "Junaid Iqbal", "0300-3344556",
         "Shop 14, Tariq Road, Karachi", "Washing Machine", "Haier", "HWM-120",
         "Door won't lock, machine shows DE error and won't start.", "t3", _dt(2026, 5, 26),
         waiting_since=date(2026, 5, 28), waiting_reason="Needs part: Door lock assembly"),
    _row(1045, "waiting", "carry-in", "Mehwish Ali", "0321-9090909",
         "Flat 7, Askari 4, Rashid Minhas Rd, Karachi", "Microwave", "Dawlance", "DW-MD10",
         "Sparking inside the cavity when running.", "t2", _dt(2026, 5, 26),
         waiting_since=date(2026, 5, 27), waiting_reason="Awaiting customer approval on estimate"),
    # ── open ──
    _row(1046, "open", "home-visit", "Yusuf Khan", "0312-6677889",
         "House 31, Phase 2, DHA, Karachi", "Split AC", "Gree", "GS-18",
         "Not cooling and water leaking from the indoor unit.", "t1", _dt(2026, 5, 28),
         preferred=date(2026, 5, 30), window="11:00 AM – 1:00 PM"),
    _row(1047, "open", "carry-in", "Zainab Malik", "0345-2223334",
         "House 16, Federal B Area, Karachi", "Washing Machine", "Samsung", "WW70",
         "Stops mid-cycle and shows UE error repeatedly.", "t2", _dt(2026, 5, 29)),
    _row(1048, "open", "carry-in", "Shahid Pervez", "0300-7778889",
         "C-22, Malir Cantt, Karachi", "Refrigerator", "Dawlance", "Chrome-91996",
         "Loud buzzing/vibration noise, but cooling is fine.", "t4", _dt(2026, 5, 29)),
    _row(1049, "open", "home-visit", "Ayesha Siddiqui", "0321-4445556",
         "House 9, Gulshan-e-Hadeed, Karachi", "Split AC", "Haier", "HSU-18",
         "Outdoor fan not spinning, AC trips after ~10 minutes.", "t5", _dt(2026, 5, 29),
         preferred=date(2026, 5, 30), window="2:00 PM – 4:00 PM"),
    _row(1050, "open", "carry-in", "Tahir Mehmood", "0345-8887776",
         "Block J, North Nazimabad, Karachi", "Microwave", "Samsung", "ME731K",
         "Turntable not rotating, heating works normally.", "t2", _dt(2026, 5, 30)),
    _row(1051, "open", "carry-in", "Sana Javed", "0312-1010101",
         "House 4, Garden East, Karachi", "Split AC", "Dawlance", "LVS-15",
         "Remote not responding, unit will not power on.", "t1", _dt(2026, 5, 30)),
]


def upgrade() -> None:
    job = op.create_table(
        "job",
        sa.Column(
            "id", PGUUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")
        ),
        sa.Column("token", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.String(length=64), nullable=False, server_default=sa.text("'default'")),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'open'")),
        sa.Column(
            "job_type", sa.String(length=16), nullable=False, server_default=sa.text("'carry-in'")
        ),
        sa.Column("customer_name", sa.String(length=128), nullable=False),
        sa.Column("customer_phone", sa.String(length=32), nullable=True),
        sa.Column("customer_address", sa.String(length=256), nullable=True),
        sa.Column("appliance_type", sa.String(length=64), nullable=False),
        sa.Column("appliance_brand", sa.String(length=64), nullable=True),
        sa.Column("appliance_model", sa.String(length=64), nullable=True),
        sa.Column("problem", sa.String(length=2048), nullable=False, server_default=sa.text("''")),
        sa.Column("assigned_tech_id", sa.String(length=64), nullable=True),
        sa.Column("preferred_date", sa.Date(), nullable=True),
        sa.Column("time_window", sa.String(length=64), nullable=True),
        sa.Column("waiting_reason", sa.String(length=256), nullable=True),
        sa.Column("waiting_since", sa.Date(), nullable=True),
        sa.Column("ready_since", sa.Date(), nullable=True),
        sa.Column("closed_at", sa.Date(), nullable=True),
        sa.Column("abandoned", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("abandon_reason", sa.String(length=256), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")
        ),
        sa.CheckConstraint(
            "status IN ('open', 'waiting', 'ready', 'closed')", name="job_status_check"
        ),
        sa.CheckConstraint("job_type IN ('carry-in', 'home-visit')", name="job_type_check"),
        sa.UniqueConstraint("token", name="uq_job_token"),
    )
    op.create_index("ix_job_shop_status", "job", ["shop_id", "status"])
    op.create_index("ix_job_assigned_tech", "job", ["assigned_tech_id"])

    op.bulk_insert(job, _SEED)


def downgrade() -> None:
    op.drop_index("ix_job_assigned_tech", table_name="job")
    op.drop_index("ix_job_shop_status", table_name="job")
    op.drop_table("job")
