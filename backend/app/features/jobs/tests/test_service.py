"""Unit tests for `JobService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.jobs.models import Job as JobRow
from app.features.jobs.schemas import JobCreate
from app.features.jobs.service import JobNotFoundError, JobService


def _persist(job: JobRow) -> JobRow:
    """Mimic the repo flush+refresh: populate the server-default columns."""
    job.id = uuid4()
    job.abandoned = False
    job.created_at = datetime.now(UTC)
    job.updated_at = datetime.now(UTC)
    return job


@pytest.fixture
def svc() -> Iterator[tuple[JobService, MagicMock]]:
    repo = MagicMock()
    repo.get = AsyncMock(return_value=None)
    repo.list = AsyncMock(return_value=[])
    repo.next_token = AsyncMock(return_value=1052)
    repo.create = AsyncMock(side_effect=_persist)
    yield JobService(repo), repo


async def test_create_assigns_token_and_open_status(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = await service.create_job(
        JobCreate(
            customer_name="  Abdul Rehman  ",
            appliance_type="Split AC",
            problem="  not cooling  ",
            assigned_tech_id="t1",
        )
    )
    assert job.token == 1052
    assert job.status == "open"
    assert job.customer_name == "Abdul Rehman"  # trimmed
    assert job.problem == "not cooling"  # trimmed
    repo.create.assert_awaited_once()


async def test_create_home_visit_keeps_schedule(svc: tuple[JobService, MagicMock]) -> None:
    service, _ = svc
    job = await service.create_job(
        JobCreate(
            job_type="home-visit",
            customer_name="Yusuf",
            customer_address="House 31, DHA",
            appliance_type="Split AC",
            time_window="11 AM – 1 PM",
        )
    )
    assert job.job_type == "home-visit"
    assert job.customer_address == "House 31, DHA"
    assert job.time_window == "11 AM – 1 PM"


async def test_create_carry_in_drops_visit_only_fields(svc: tuple[JobService, MagicMock]) -> None:
    service, _ = svc
    job = await service.create_job(
        JobCreate(
            job_type="carry-in",
            customer_name="Zainab",
            customer_address="ignored for carry-in",
            appliance_type="Washing Machine",
            time_window="should be dropped",
        )
    )
    assert job.customer_address is None
    assert job.time_window is None


async def test_get_missing_raises_not_found(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = None
    with pytest.raises(JobNotFoundError):
        await service.get_job(job_id=uuid4(), shop_id="default")


async def test_get_wrong_shop_raises_not_found(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _persist(
        JobRow(
            token=1,
            shop_id="other",
            status="open",
            job_type="carry-in",
            customer_name="x",
            appliance_type="AC",
            problem="",
        )
    )
    with pytest.raises(JobNotFoundError):
        await service.get_job(job_id=uuid4(), shop_id="default")


async def test_list_passes_filters_through(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    await service.list_jobs(shop_id="default", status="ready", assigned_tech_id="t2", search="ac")
    repo.list.assert_awaited_once_with(
        shop_id="default", status="ready", assigned_tech_id="t2", search="ac"
    )
