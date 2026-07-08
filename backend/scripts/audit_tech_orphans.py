"""Read-only orphan audit for the seven tech-ref columns (W12 → W13 gate).

Run from ``backend/``::

    python -m scripts.audit_tech_orphans

The tech-ref FKs land NOT VALID in 0032; their VALIDATE is 0033. This report is
the precondition for opening W13: every column must show 0 orphans against prod
before the VALIDATE migration is deployed. Read-only — never writes.
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import text

import app.registry  # noqa: F401  # full metadata (kept consistent with the other scripts)
from app.core.db import SessionLocal

# (label, table, column) — the seven refs 0032 added NOT VALID.
_REFS = [
    ("job.assigned_tech_id", "job", "assigned_tech_id"),
    ("attendance_event.tech_id", "attendance_event", "tech_id"),
    ("attendance_presence_event.tech_id", "attendance_presence_event", "tech_id"),
    ("attendance_ping.tech_id", "attendance_ping", "tech_id"),
    ("attendance_shift.tech_id", "attendance_shift", "tech_id"),
    ("attendance_adjustment.manager_id", "attendance_adjustment", "manager_id"),
    ("device_token.tech_id", "device_token", "tech_id"),
]


async def run() -> bool:
    all_clean = True
    async with SessionLocal() as session:
        print("=== tech-ref orphan audit (0 => 0033 VALIDATE is safe) ===")
        for label, table, col in _REFS:
            stmt = text(
                f"SELECT count(*) FROM {table} x "  # noqa: S608 — table/col from a fixed allow-list
                f"WHERE x.{col} IS NOT NULL "
                f"AND NOT EXISTS (SELECT 1 FROM technician t WHERE t.id = x.{col})"
            )
            n = (await session.execute(stmt)).scalar_one()
            flag = "OK" if n == 0 else "ORPHANS"
            if n != 0:
                all_clean = False
            print(f"  [{flag:8}] {label}: {n}")
    print("\nALL CLEAN" if all_clean else "\nORPHANS FOUND — do NOT open W13")
    return all_clean


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    clean = asyncio.run(run())
    sys.exit(0 if clean else 1)


if __name__ == "__main__":
    main()
