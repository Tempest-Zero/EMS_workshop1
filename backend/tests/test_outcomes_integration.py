"""Integration: the job_outcome auto-link re-failure scan (W8).

Real Postgres. Two jobs on the same appliance unit, the first closed and the
second created within the window, should produce one ``auto_link`` re-failure
outcome — and a re-run must add nothing (idempotent).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.customers.models import ApplianceUnit, Customer
from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobOutcome
from app.features.jobs.service import run_outcome_auto_link_scan

pytestmark = pytest.mark.integration


async def _seed_unit(session: AsyncSession) -> ApplianceUnit:
    customer = Customer(full_name="Ali", shop_id="default", source="backfill")
    session.add(customer)
    await session.flush()
    unit = ApplianceUnit(
        shop_id="default", customer_id=customer.id, category_id="ac", brand_raw="Haier"
    )
    session.add(unit)
    await session.flush()
    return unit


async def _seed_job(
    session: AsyncSession, *, token: int, unit_id: UUID, closed_at: datetime | None = None
) -> JobRow:
    job = JobRow(
        token=token,
        shop_id="default",
        status="closed" if closed_at is not None else "open",
        customer_name="Ali",
        appliance_type="Split AC",
        appliance_unit_id=unit_id,
        closed_at=closed_at,
    )
    session.add(job)
    await session.flush()
    return job


async def test_auto_link_records_refailure_and_is_idempotent(session: AsyncSession) -> None:
    unit = await _seed_unit(session)
    now = datetime.now(UTC)
    earlier = await _seed_job(
        session, token=9001, unit_id=unit.id, closed_at=now - timedelta(days=10)
    )
    later = await _seed_job(session, token=9002, unit_id=unit.id)
    await session.commit()

    inserted = await run_outcome_auto_link_scan(session)
    assert inserted == 1

    outcome = (await session.execute(select(JobOutcome))).scalars().one()
    assert outcome.job_id == earlier.id
    assert outcome.refail_job_id == later.id
    assert outcome.channel == "auto_link"
    assert outcome.result == "re_failed"
    assert outcome.recorded_by == "system"

    # Re-run adds nothing — the (repair, follow-up) pair is already linked.
    again = await run_outcome_auto_link_scan(session)
    assert again == 0
    assert len((await session.execute(select(JobOutcome))).scalars().all()) == 1


async def test_auto_link_ignores_jobs_outside_window(session: AsyncSession) -> None:
    unit = await _seed_unit(session)
    now = datetime.now(UTC)
    # First job closed 200 days ago → a job created now is >90 days later.
    await _seed_job(session, token=9003, unit_id=unit.id, closed_at=now - timedelta(days=200))
    await _seed_job(session, token=9004, unit_id=unit.id)
    await session.commit()

    assert await run_outcome_auto_link_scan(session) == 0
    assert (await session.execute(select(JobOutcome))).scalars().all() == []
