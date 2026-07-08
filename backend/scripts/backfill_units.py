"""Create appliance units from historical jobs (W4 backfill).

Run from ``backend/``::

    python -m scripts.backfill_units            # dry-run (report only)
    python -m scripts.backfill_units --apply    # write

One unit per (customer × category × normalized brand/model raw) cluster of
linked jobs — the plan's deliberate **under-merge**: a false split just loses a
re-failure link later; a false merge would fabricate one (the W8 outcome scan
treats shared units as facts). Jobs without a ``customer_id`` (no phone match)
or without a ``category_id`` are skipped and reported — they can't anchor a
unit.

Idempotent: jobs with ``appliance_unit_id`` set are skipped; clusters reuse an
existing unit matching the same natural key before creating one.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import defaultdict

from sqlalchemy import select

import app.registry  # noqa: F401  # full metadata: flush must resolve cross-slice FKs
from app.core.db import SessionLocal
from app.features.customers.models import ApplianceUnit
from app.features.jobs.models import Job

_SAMPLE = 20


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


async def run(*, apply: bool) -> None:
    async with SessionLocal() as session:
        jobs = list(
            (await session.execute(select(Job).where(Job.appliance_unit_id.is_(None)))).scalars()
        )
        units = list((await session.execute(select(ApplianceUnit))).scalars())
        by_key = {
            (u.customer_id, u.category_id, _norm(u.brand_raw), _norm(u.model_raw)): u.id
            for u in units
        }

        no_customer = sum(1 for j in jobs if j.customer_id is None)
        no_category = sum(1 for j in jobs if j.customer_id is not None and j.category_id is None)

        clusters: dict[tuple, list[Job]] = defaultdict(list)
        for job in jobs:
            if job.customer_id is None or job.category_id is None:
                continue
            key = (
                job.customer_id,
                job.category_id,
                _norm(job.appliance_brand),
                _norm(job.appliance_model),
            )
            clusters[key].append(job)

        created = reused = linked = 0
        samples: list[str] = []
        for key, cluster in sorted(clusters.items(), key=lambda kv: str(kv[0])):
            customer_id, category_id, brand_n, model_n = key
            unit_id = by_key.get(key)
            if unit_id is not None:
                reused += 1
            else:
                created += 1
                if apply:
                    first = cluster[0]
                    unit = ApplianceUnit(
                        shop_id=first.shop_id,
                        customer_id=customer_id,
                        category_id=category_id,
                        brand_raw=first.appliance_brand,
                        model_raw=first.appliance_model,
                    )
                    session.add(unit)
                    await session.flush()
                    unit_id = unit.id
                    by_key[key] = unit_id
                if len(samples) < _SAMPLE:
                    samples.append(
                        f"{category_id} / {brand_n or '<no brand>'} / "
                        f"{model_n or '<no model>'} ({len(cluster)} job(s))"
                    )
            if apply and unit_id is not None:
                for job in cluster:
                    job.appliance_unit_id = unit_id
            linked += len(cluster)
            if apply:
                await session.commit()  # per-cluster: interrupt-safe, resumable

        mode = "APPLIED" if apply else "DRY-RUN (no writes)"
        print(f"=== backfill_units [{mode}] ===")
        print(f"unlinked jobs scanned:          {len(jobs)}")
        print(f"skipped (no customer link):     {no_customer}")
        print(f"skipped (no category):          {no_category}")
        print(f"units created:                  {created}")
        print(f"clusters reusing a unit:        {reused}")
        print(f"jobs linked to a unit:          {linked}")
        print(f"\ncreated units (first {_SAMPLE}):")
        for s in samples:
            print(f"  {s}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Backfill appliance units from jobs.")
    parser.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
