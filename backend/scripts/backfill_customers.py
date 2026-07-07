"""Cluster historical jobs into customer identities (W2 backfill).

Run from ``backend/``::

    python -m scripts.backfill_customers            # dry-run (report only)
    python -m scripts.backfill_customers --apply    # write

What it does, per shop:
- Groups unlinked jobs (``job.customer_id IS NULL``) by E.164-normalized phone.
- A phone already in ``customer_phone`` → reuse that customer, link the cluster.
- An unambiguous new cluster (all jobs share one customer name) → create
  ``customer(source='backfill')`` + ``customer_phone`` + link the cluster.
- An ambiguous cluster (one number, several names — a shared/household number)
  is **reported only**, never auto-created or auto-merged.

Idempotent: linked jobs are skipped on the initial query and existing phones are
reused, so a re-run (after an interrupt) resumes cleanly. Also emits an
address→area "mining" suggestion report (a hint for curating more areas — never
an automatic write).
"""

from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict

from sqlalchemy import select

from app.core.db import SessionLocal
from app.features.customers.models import Customer, CustomerPhone
from app.features.customers.service import normalize_phone_e164
from app.features.jobs.models import Job
from app.features.tenancy.models import Area

_SAMPLE = 20


async def run(*, apply: bool) -> None:
    async with SessionLocal() as session:
        jobs = list((await session.execute(select(Job).where(Job.customer_id.is_(None)))).scalars())
        existing_phone = {
            row.phone_e164: row.customer_id
            for row in (await session.execute(select(CustomerPhone))).scalars()
        }

        clusters: dict[str, list[Job]] = defaultdict(list)
        no_valid_phone = 0
        for job in jobs:
            norm = normalize_phone_e164(job.customer_phone)
            if norm is None:
                no_valid_phone += 1
                continue
            clusters[norm].append(job)

        created = reused = ambiguous = linked = 0
        created_samples: list[str] = []
        ambiguous_samples: list[str] = []

        for phone, cluster in sorted(clusters.items()):
            names = {j.customer_name.strip() for j in cluster if j.customer_name}
            shop_id = cluster[0].shop_id

            if phone in existing_phone:
                customer_id = existing_phone[phone]
                for job in cluster:
                    job.customer_id = customer_id
                reused += 1
                linked += len(cluster)
            elif len(names) != 1:
                ambiguous += 1
                if len(ambiguous_samples) < _SAMPLE:
                    ambiguous_samples.append(f"{phone}: {sorted(names)}")
                continue
            else:
                name = next(iter(names))
                if apply:
                    customer = Customer(full_name=name, shop_id=shop_id, source="backfill")
                    session.add(customer)
                    await session.flush()
                    session.add(
                        CustomerPhone(
                            customer_id=customer.id,
                            phone_e164=phone,
                            label="primary",
                            is_primary=True,
                        )
                    )
                    for job in cluster:
                        job.customer_id = customer.id
                created += 1
                linked += len(cluster)
                if len(created_samples) < _SAMPLE:
                    created_samples.append(f"{phone} → {name} ({len(cluster)} job(s))")

            if apply:
                await session.commit()  # per-cluster: interrupt-safe, resumable

        # Address → area "mining" suggestions (report only).
        area_names = [
            a.name.lower()
            for a in (await session.execute(select(Area))).scalars()
            if a.name.lower() != "other"
        ]
        unmatched_addr: list[str] = []
        for job in jobs:
            addr = (job.customer_address or "").strip()
            if addr and not any(a in addr.lower() for a in area_names):
                if len(unmatched_addr) < _SAMPLE:
                    unmatched_addr.append(addr)

        mode = "APPLIED" if apply else "DRY-RUN (no writes)"
        print(f"=== backfill_customers [{mode}] ===")
        print(f"unlinked jobs scanned:        {len(jobs)}")
        print(f"jobs with no valid phone:     {no_valid_phone}")
        print(f"customers created:            {created}")
        print(f"clusters reusing a customer:  {reused}")
        print(f"ambiguous clusters (skipped): {ambiguous}")
        print(f"jobs linked to a customer:    {linked}")
        print(f"\ncreated (first {_SAMPLE}):")
        for s in created_samples:
            print(f"  {s}")
        print(f"\nambiguous — one number, several names (first {_SAMPLE}):")
        for s in ambiguous_samples:
            print(f"  {s}")
        print(f"\naddresses matching no seeded area — curation hints (first {_SAMPLE}):")
        for s in unmatched_addr:
            print(f"  {s}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill customer identities from jobs.")
    parser.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
