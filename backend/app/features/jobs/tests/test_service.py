"""Unit tests for `JobService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobCompletion, JobEvent, JobLocation, JobPayment
from app.features.jobs.schemas import (
    CompletionRequest,
    JobCreate,
    LocationRequest,
    MaterialIn,
    TransitionRequest,
)
from app.features.jobs.service import (
    JobActionError,
    JobNotFoundError,
    JobService,
    route_fuel_paisa,
)


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
    job.bill_status = "none"
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
    repo.get_completion = AsyncMock(return_value=None)
    repo.list_materials = AsyncMock(return_value=[])
    repo.add_completion = AsyncMock(side_effect=lambda c: c)
    repo.clear_materials = AsyncMock()
    repo.add_material = AsyncMock(side_effect=lambda m: m)
    repo.list_payments = AsyncMock(return_value=[])
    repo.get_payment = AsyncMock(return_value=None)
    repo.get_payment_by_client = AsyncMock(return_value=None)
    repo.add_payment = AsyncMock(side_effect=lambda p: p)
    repo.list_locations = AsyncMock(return_value=[])
    repo.get_location_by_client = AsyncMock(return_value=None)
    repo.add_location = AsyncMock(side_effect=lambda loc: loc)
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


async def test_close_requires_a_closing_video(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    media = AsyncMock()
    media.count_phase = AsyncMock(return_value=0)  # no closing clip
    with pytest.raises(JobActionError):
        await service.transition(
            job_id=job.id,
            shop_id="default",
            body=TransitionRequest(action="close"),
            actor="t1",
            media=media,
        )
    media.count_phase.assert_awaited_once_with(job_id=str(job.token), phase="closing")


async def test_close_succeeds_with_a_closing_video(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    media = AsyncMock()
    media.count_phase = AsyncMock(return_value=1)  # a pending closing row counts
    detail = await service.transition(
        job_id=job.id,
        shop_id="default",
        body=TransitionRequest(action="close"),
        actor="t1",
        media=media,
    )
    assert detail.status == "closed"
    assert job.closed_at is not None


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


# ── completion + bill (paisa) ────────────────────────────────────────────────
async def test_submit_completion_generates_bill_in_paisa(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    body = CompletionRequest(
        materials=[MaterialIn(name="Relay", qty=2, unit_paisa=60000)],  # 120000
        time_spent_mins=60,  # labour = 1h × Rs1200 = 120000
        fuel_paisa=50000,
    )
    detail = await service.submit_completion(
        job_id=job.id, shop_id="default", body=body, actor="t1"
    )
    assert detail.bill_original_paisa == 290000  # 120000 + 120000 + 50000
    assert detail.bill_status == "generated"
    repo.add_material.assert_awaited_once()
    assert repo.add_event.await_args.args[0].kind == "complete"


async def test_completion_upsert_clears_old_materials(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    existing = JobCompletion(job_id=job.id)
    existing.id = uuid4()
    repo.get_completion.return_value = existing
    await service.submit_completion(
        job_id=job.id,
        shop_id="default",
        body=CompletionRequest(materials=[MaterialIn(name="x", qty=1, unit_paisa=1000)]),
        actor="t1",
    )
    repo.clear_materials.assert_awaited_once_with(existing.id)
    repo.add_completion.assert_not_awaited()  # reused the existing row


async def test_negotiate_requires_a_generated_bill(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()  # bill_original_paisa is None
    repo.get.return_value = job
    with pytest.raises(JobActionError):
        await service.negotiate_bill(
            job_id=job.id, shop_id="default", amount_paisa=100000, note=None, actor="t1"
        )


async def test_negotiate_sets_amount_keeps_original(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    job.bill_original_paisa = 500000
    repo.get.return_value = job
    detail = await service.negotiate_bill(
        job_id=job.id, shop_id="default", amount_paisa=420000, note="waived call-out", actor="t1"
    )
    assert detail.bill_original_paisa == 500000  # kept
    assert detail.bill_negotiated_paisa == 420000
    assert detail.bill_status == "negotiated"
    assert repo.add_event.await_args.args[0].kind == "bill"


# ── cash / revenue ledger ────────────────────────────────────────────────────
async def test_log_payment_is_idempotent_on_client_id(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    cid = uuid4()

    repo.get_payment_by_client.return_value = None  # first time → record it
    await service.log_payment(
        job_id=job.id,
        shop_id="default",
        amount_paisa=200000,
        method="cash",
        client_id=cid,
        actor="t1",
    )
    repo.add_payment.assert_awaited_once()

    # Replay the same client_id (offline retry) → found → NOT charged again.
    repo.get_payment_by_client.return_value = JobPayment(
        job_id=job.id, client_id=cid, amount_paisa=200000, method="cash"
    )
    await service.log_payment(
        job_id=job.id,
        shop_id="default",
        amount_paisa=200000,
        method="cash",
        client_id=cid,
        actor="t1",
    )
    repo.add_payment.assert_awaited_once()  # still once


async def test_void_payment_marks_voided(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    payment = JobPayment(job_id=job.id, client_id=uuid4(), amount_paisa=100000, method="cash")
    payment.id = uuid4()
    payment.voided = False
    repo.get_payment.return_value = payment
    await service.void_payment(
        job_id=job.id, shop_id="default", payment_id=payment.id, reason="wrong amount", actor="t1"
    )
    assert payment.voided is True
    assert payment.void_reason == "wrong amount"


async def test_detail_received_excludes_voided(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    job.bill_original_paisa = 500000
    repo.get.return_value = job

    def _pay(amount: int, voided: bool) -> JobPayment:
        p = JobPayment(job_id=job.id, client_id=uuid4(), amount_paisa=amount, method="cash")
        p.id = uuid4()
        p.voided = voided
        p.void_reason = "x" if voided else None
        p.recorded_at = datetime.now(UTC)
        return p

    repo.list_payments.return_value = [_pay(200000, False), _pay(100000, True)]
    detail = await service.get_job(job_id=job.id, shop_id="default")
    assert detail.received_paisa == 200000  # voided 100000 excluded
    assert detail.balance_paisa == 300000  # 500000 - 200000


# ── GPS route (Phase 3) ──────────────────────────────────────────────────────
def _loc(kind: str, lat: float, lng: float, *, is_mock: bool = False) -> JobLocation:
    loc = JobLocation(
        job_id=uuid4(), client_id=uuid4(), kind=kind, lat=lat, lng=lng, is_mock=is_mock
    )
    loc.id = uuid4()
    loc.accuracy_m = None
    loc.captured_at = datetime.now(UTC)
    loc.device_time = None
    return loc


def test_route_fuel_paisa_is_integer_paisa() -> None:
    # 2 km at Rs 20/km = Rs 40 = 4000 paisa; rounds to the nearest paisa.
    assert route_fuel_paisa(2000, 2000) == 4000
    assert route_fuel_paisa(1500, 2000) == 3000


async def test_record_location_adds_punch_and_gps_event(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    await service.record_location(
        job_id=job.id,
        shop_id="default",
        body=LocationRequest(kind="depart_workshop", lat=24.86, lng=67.0, client_id=uuid4()),
        actor="t1",
    )
    repo.add_location.assert_awaited_once()
    assert repo.add_event.await_args.args[0].kind == "gps"


async def test_record_location_is_idempotent_on_client_id(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    cid = uuid4()
    body = LocationRequest(kind="depart_workshop", lat=24.86, lng=67.0, client_id=cid)

    repo.get_location_by_client.return_value = None
    await service.record_location(job_id=job.id, shop_id="default", body=body, actor="t1")
    repo.add_location.assert_awaited_once()

    # Replay the same client_id (offline retry) → found → not re-recorded.
    repo.get_location_by_client.return_value = _loc("depart_workshop", 24.86, 67.0)
    await service.record_location(job_id=job.id, shop_id="default", body=body, actor="t1")
    repo.add_location.assert_awaited_once()  # still once


async def test_record_location_stores_mock_flag(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    await service.record_location(
        job_id=job.id,
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer", lat=24.87, lng=67.01, is_mock=True, client_id=uuid4()
        ),
        actor="t1",
    )
    assert repo.add_location.await_args.args[0].is_mock is True
    assert "mock" in repo.add_event.await_args.args[0].text


async def test_detail_derives_route_once_both_pins_exist(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_locations.return_value = [
        _loc("depart_workshop", 24.8607, 67.0011),
        _loc("arrive_customer", 24.8615, 67.0099),
    ]
    detail = await service.get_job(job_id=job.id, shop_id="default")
    assert detail.route is not None
    assert detail.route.distance_m > 0
    assert detail.route.fuel_paisa > 0
    assert len(detail.locations) == 2


async def test_detail_route_none_with_one_pin(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_locations.return_value = [_loc("depart_workshop", 24.86, 67.0)]
    detail = await service.get_job(job_id=job.id, shop_id="default")
    assert detail.route is None
    assert len(detail.locations) == 1
