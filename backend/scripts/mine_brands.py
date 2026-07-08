"""Reconcile historical ``job.appliance_brand`` into the catalog (W3).

Run from ``backend/``::

    python -m scripts.mine_brands            # dry-run (report only)
    python -m scripts.mine_brands --apply    # write

For each distinct ``job.appliance_brand``:
- exact match to a canonical brand or an existing alias → known (skip);
- edit-distance ≤2 to a canonical → propose a ``brand_alias`` (so the same
  misspelling auto-resolves forever after);
- otherwise → propose a new ``appliance_brand(status='pending_review')`` for a
  manager to approve.

Idempotent: canonical/aliased names (including previously-mined pending brands)
are pre-checked, and the unique constraints backstop ``--apply``.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from app.core.db import SessionLocal
from app.features.catalog.models import ApplianceBrand, BrandAlias
from app.features.jobs.models import Job

_MAX_EDIT = 2


def _norm(s: str) -> str:
    return s.strip().upper()


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    if not a or not b:
        return len(a) + len(b)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


async def run(*, apply: bool) -> None:
    async with SessionLocal() as session:
        raw_values = [
            r.strip()
            for r in (
                await session.execute(
                    select(Job.appliance_brand).where(Job.appliance_brand.is_not(None)).distinct()
                )
            ).scalars()
            if r and r.strip()
        ]
        brands = list((await session.execute(select(ApplianceBrand))).scalars())
        canon = {_norm(b.name_canonical): b for b in brands}
        aliases = {
            _norm(a.alias_norm) for a in (await session.execute(select(BrandAlias))).scalars()
        }

        known: list[str] = []
        aliased: list[tuple[str, str, int]] = []
        pending: list[str] = []
        seen_new: set[str] = set()

        for raw in sorted(set(raw_values)):
            norm = _norm(raw)
            if norm in canon or norm in aliases or norm in seen_new:
                known.append(raw)
                continue
            best = min(
                canon.values(),
                key=lambda b: _levenshtein(norm, _norm(b.name_canonical)),
                default=None,
            )
            dist = _levenshtein(norm, _norm(best.name_canonical)) if best else _MAX_EDIT + 1
            if best is not None and dist <= _MAX_EDIT:
                aliased.append((raw, best.name_canonical, dist))
                if apply:
                    session.add(BrandAlias(alias_norm=norm, brand_id=best.id))
            else:
                pending.append(raw)
                if apply:
                    session.add(ApplianceBrand(name_canonical=raw, status="pending_review"))
            seen_new.add(norm)

        if apply:
            await session.commit()

        mode = "APPLIED" if apply else "DRY-RUN (no writes)"
        print(f"=== mine_brands [{mode}] ===")
        print(f"distinct historical brands: {len(set(raw_values))}")
        print(f"already known:              {len(known)}  {sorted(set(known))}")
        print(f"proposed aliases (dist<=2): {len(aliased)}")
        for raw, canonical, dist in aliased:
            print(f"  {raw!r} -> {canonical} (dist {dist})")
        print(f"proposed pending brands:    {len(pending)}")
        for raw in pending:
            print(f"  {raw!r}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Mine historical job brands into the catalog.")
    parser.add_argument("--apply", action="store_true", help="write (default: dry-run)")
    args = parser.parse_args()
    asyncio.run(run(apply=args.apply))


if __name__ == "__main__":
    main()
