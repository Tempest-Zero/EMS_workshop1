"""Phase 4 money-integrity guards: the bill of a closed job is a settled
document; close requires the completion form; waiting becomes reachable; the
labour rate is snapshotted. Repository mocked — no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobCompletion
from app.features.jobs.schemas import CompletionRequest, MaterialIn, TransitionRequest
from app.features.jobs.service import (
    JobActionError,
    JobConflictError,
    JobService,
)


def _persist(row: JobRow) -> JobRow:
    row.id = uuid4()
    row.abandoned = False
    row.bill_status = "none"
    row.created_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    return row


def _job(status: str = "open") -> JobRow:
    return _persist(
        JobRow(
            token=1060,
            shop_id="default",
            status=status,
            job_type="carry-in",
            customer_name="Yusuf",
            appliance_type="Split AC",
            problem="leaking",
        )
    )


def _completion(rate: int = 120000) -> JobCompletion:
    done = JobCompletion(
        job_id=uuid4(),
        labour_rate_paisa=rate,
        time_spent_mins=60,
        fuel_paisa=0,
        submitted_at=datetime.now(UTC),
    )
    done.id = uuid4()
    return done


@pytest.fixture
def svc() -> Iterator[tuple[JobService, MagicMock]]:
    repo = MagicMock()
    repo.get = AsyncMock()
    repo.add_event = AsyncMock()
    repo.list_events = AsyncMock(return_value=[])
    repo.list_payments = AsyncMock(return_value=[])
    repo.list_locations = AsyncMock(return_value=[])
    repo.list_materials = AsyncMock(return_value=[])
    repo.get_completion = AsyncMock(return_value=None)
    repo.add_completion = AsyncMock()
    repo.clear_materials = AsyncMock()
    repo.add_material = AsyncMock()
    yield JobService(repo), repo


async def test_completion_on_a_closed_job_is_a_conflict(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _job("closed")
    with pytest.raises(JobConflictError, match="closed"):
        await service.submit_completion(
            job_id=uuid4(),
            shop_id="default",
            body=CompletionRequest(materials=[MaterialIn(name="x", qty=1, unit_paisa=100)]),
            actor="t1",
        )


async def test_negotiate_on_a_closed_job_is_a_conflict(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _job("closed")
    job.bill_original_paisa = 500000
    repo.get.return_value = job
    with pytest.raises(JobConflictError, match="closed"):
        await service.negotiate_bill(
            job_id=uuid4(), shop_id="default", amount_paisa=400000, note=None, actor="t1"
        )


async def test_close_without_completion_is_a_conflict(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _job("ready")
    media = AsyncMock()
    media.count_phase = AsyncMock(return_value=1)
    with pytest.raises(JobConflictError, match="completion"):
        await service.transition(
            job_id=uuid4(),
            shop_id="default",
            body=TransitionRequest(action="close"),
            actor="t1",
            media=media,
        )


async def test_abandon_still_closes_without_a_completion(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _job("open")
    repo.get.return_value = job
    detail = await service.transition(
        job_id=uuid4(),
        shop_id="default",
        body=TransitionRequest(action="abandon", reason="customer unreachable"),
        actor="t1",
    )
    assert detail.status == "closed"
    assert detail.abandoned is True


async def test_wait_transition_sets_reason_and_since(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _job("open")
    repo.get.return_value = job
    detail = await service.transition(
        job_id=uuid4(),
        shop_id="default",
        body=TransitionRequest(action="wait", reason="part on order: PCB"),
        actor="t1",
    )
    assert detail.status == "waiting"
    assert detail.waiting_reason == "part on order: PCB"
    assert detail.waiting_since is not None


async def test_wait_without_a_reason_is_rejected(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _job("open")
    with pytest.raises(JobActionError, match="reason"):
        await service.transition(
            job_id=uuid4(),
            shop_id="default",
            body=TransitionRequest(action="wait"),
            actor="t1",
        )


async def test_resubmit_reuses_the_snapshotted_labour_rate(
    svc: tuple[JobService, MagicMock],
) -> None:
    # The completion was first submitted at Rs 900/h; a config change to
    # Rs 1200/h later must NOT reprice the resubmit.
    service, repo = svc
    job = _job("open")
    repo.get.return_value = job
    existing = _completion(rate=90000)
    repo.get_completion.return_value = existing

    await service.submit_completion(
        job_id=uuid4(),
        shop_id="default",
        body=CompletionRequest(time_spent_mins=60),  # 1h labour, nothing else
        actor="t1",
    )

    assert job.bill_original_paisa == 90000  # the snapshot, not the config rate
    repo.add_completion.assert_not_awaited()


async def test_negotiate_event_records_the_prior_amount(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _job("ready")
    job.bill_original_paisa = 500000
    job.bill_negotiated_paisa = 450000
    repo.get.return_value = job

    await service.negotiate_bill(
        job_id=uuid4(), shop_id="default", amount_paisa=400000, note=None, actor="t1"
    )

    event = repo.add_event.call_args.args[0]
    assert "Rs 4,500 → Rs 4,000" in event.text
