"""Unit tests for `JobService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobEvent
from app.features.jobs.schemas import JobCreate, TransitionRequest
from app.features.jobs.service import JobActionError, JobNotFoundError, JobService


def _event(kind: str, text: str = "x") -> JobEvent:
    return JobEvent(
        id=uuid4(),
        job_id=uuid4(),
        kind=kind,
        text=text,
        actor="t1",
        created_at=datetime.now(UTC),
    )


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
    repo.list_jobs = AsyncMock(return_value=[])
    repo.next_token = AsyncMock(return_value=1052)
    repo.create = AsyncMock(side_effect=_persist)
    repo.add_event = AsyncMock(side_effect=lambda e: e)
    repo.list_events = AsyncMock(return_value=[])
    yield JobService(repo), repo


def _open_job() -> JobRow:
    return _persist(
        JobRow(
            token=1052,
            shop_id="default",
            status="open",
            job_type="home-visit",
            customer_name="Yusuf",
            appliance_type="Split AC",
            problem="leaking",
        )
    )


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
    repo.list_jobs.assert_awaited_once_with(
        shop_id="default", status="ready", assigned_tech_id="t2", search="ac"
    )


# ── lifecycle / timeline ─────────────────────────────────────────────────────
async def test_create_appends_a_create_event(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    await service.create_job(JobCreate(customer_name="A", appliance_type="AC"))
    kinds = [call.args[0].kind for call in repo.add_event.await_args_list]
    assert "create" in kinds


async def test_get_returns_detail_with_timeline(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_events.return_value = [_event("note", "Note: hi")]
    detail = await service.get_job(job_id=job.id, shop_id="default")
    assert len(detail.events) == 1
    assert detail.events[0].kind == "note"


async def test_add_note_appends_note_event(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    await service.add_note(job_id=job.id, shop_id="default", text="  check capacitor  ", actor="t1")
    ev = repo.add_event.await_args.args[0]
    assert ev.kind == "note"
    assert "check capacitor" in ev.text
    assert ev.actor == "t1"


async def test_transition_ready_sets_status(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    detail = await service.transition(
        job_id=job.id, shop_id="default", body=TransitionRequest(action="ready"), actor="t1"
    )
    assert detail.status == "ready"
    assert job.ready_since is not None
    assert repo.add_event.await_args.args[0].kind == "ready"


async def test_transition_abandon_requires_reason(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    with pytest.raises(JobActionError):
        await service.transition(
            job_id=job.id, shop_id="default", body=TransitionRequest(action="abandon"), actor="t1"
        )


async def test_transition_abandon_with_reason(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    detail = await service.transition(
        job_id=job.id,
        shop_id="default",
        body=TransitionRequest(action="abandon", reason="irreparable"),
        actor="t1",
    )
    assert detail.status == "closed"
    assert detail.abandoned is True
    assert detail.abandon_reason == "irreparable"


async def test_transition_haul_converts_to_carry_in(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()  # home-visit
    repo.get.return_value = job
    detail = await service.transition(
        job_id=job.id, shop_id="default", body=TransitionRequest(action="haul"), actor="t1"
    )
    assert detail.job_type == "carry-in"


async def test_assign_sets_tech_and_logs_assign_event(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    detail = await service.assign_job(
        job_id=job.id, shop_id="default", tech_id="t3", actor="t1", claimed=False
    )
    assert detail.assigned_tech_id == "t3"
    assert repo.add_event.await_args.args[0].kind == "assign"


async def test_claim_sets_tech_and_logs_claim_event(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    detail = await service.assign_job(
        job_id=job.id, shop_id="default", tech_id="t2", actor="t2", claimed=True
    )
    assert detail.assigned_tech_id == "t2"
    assert repo.add_event.await_args.args[0].kind == "claim"
