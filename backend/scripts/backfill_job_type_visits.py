"""Flip mistyped carry-in jobs that carry a customer address to home-visit.

Run from ``backend/``::

    python -m scripts.backfill_job_type_visits            # dry-run (report only)
    python -m scripts.backfill_job_type_visits --apply    # write

``job_type`` has server-defaulted to ``carry-in`` since 0005, and the web
intake preselected it, so historical rows created for a home visit —
recognizable by their customer address, which the create path only keeps for
travel jobs — sit in the DB as carry-ins. On the phone that hides the whole
travel flow (no START TRAVEL, no map, no fuel leg).

Conservative on purpose: only rows whose address is non-blank flip, and only
from ``carry-in`` (explicit home-visit / pickup-delivery rows are untouched).
A carry-in the tech deliberately converted FROM a visit (the haul transition
keeps the address) is recognized by its haul timeline event and skipped.
Closed jobs are skipped too — their travel never happened and flipping the
type would only rewrite history.

Idempotent: a second run finds nothing left to flip.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

import app.registry  # noqa: F401  # full metadata (kept consistent with the other scripts)
from app.core.db import SessionLocal
from app.features.jobs.models import Job, JobEvent

_SAMPLE = 20
_HAUL_EVENT_TEXT = "Converted home visit to carry-in (hauled to shop)"


async def run(*, apply: bool) -> None:
    async with SessionLocal() as session:
        rows = list(
            (
                await session.execute(
                    select(Job).where(
                        Job.job_type == "carry-in",
                        Job.customer_address.is_not(None),
                        Job.status != "closed",
                    )
                )
            ).scalars()
        )
        hauled = set(
            (
                await session.execute(
                    select(JobEvent.job_id).where(JobEvent.text == _HAUL_EVENT_TEXT)
                )
            ).scalars()
        )
        candidates = [r for r in rows if (r.customer_address or "").strip() and r.id not in hauled]

        print(f"=== carry-in rows holding an address (open/waiting/ready): {len(candidates)} ===")
        for row in candidates[:_SAMPLE]:
            print(f"  #{row.token}  {row.customer_name!r}  addr={row.customer_address!r}")
        if len(candidates) > _SAMPLE:
            print(f"  … and {len(candidates) - _SAMPLE} more")

        if not apply:
            print("\nDry run — nothing written. Re-run with --apply to flip them to home-visit.")
            return

        for row in candidates:
            row.job_type = "home-visit"
        await session.commit()
        print(f"\nApplied: {len(candidates)} job(s) flipped to home-visit.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write (default is dry-run)")
    args = parser.parse_args()
    try:
        asyncio.run(run(apply=args.apply))
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
