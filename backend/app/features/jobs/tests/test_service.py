"""Unit tests for `JobService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import (
    JobCompletion,
    JobEvent,
    JobLocation,
    JobPayment,
    JobTravelSample,
)
from app.features.jobs.schemas import (
    CompletionRequest,
    JobCreate,
    LocationRequest,
    MaterialIn,
    TransitionRequest,
    TravelSampleBatch,
    TravelSampleIn,
)
from app.features.jobs.service import (
    JobActionError,
    JobConflictError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
    decimate_trail,
    derive_route,
    path_sum_m,
    route_fuel_paisa,
)
from app.shared.geo import haversine_m


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
    repo.get_by_client_id = AsyncMock(return_value=None)
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
    repo.list_travel_samples = AsyncMock(return_value=[])
    repo.create_travel_samples = AsyncMock(return_value=0)
    repo.try_claim = AsyncMock(return_value=True)
    repo.refresh = AsyncMock()
    repo.rollback = AsyncMock()
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


async def test_create_dedupes_on_client_id(svc: tuple[JobService, MagicMock]) -> None:
    """A replayed offline create (same client_id) returns the existing job —
    no second row, no second token, no duplicate 'create' event."""
    service, repo = svc
    client_id = uuid4()
    existing = _open_job()
    existing.client_id = client_id
    repo.get_by_client_id.return_value = existing

    job = await service.create_job(
        JobCreate(customer_name="Yusuf", appliance_type="Split AC", client_id=client_id)
    )

    assert job.id == existing.id
    repo.create.assert_not_awaited()
    repo.add_event.assert_not_awaited()


async def test_create_client_id_race_recovers_as_dedupe(
    svc: tuple[JobService, MagicMock],
) -> None:
    """Two concurrent sends of one queued create: the loser's IntegrityError on
    uq_job_client_id resolves to the winner's row, never a 500 or a retry."""
    service, repo = svc
    client_id = uuid4()
    winner = _open_job()
    winner.client_id = client_id
    # Fast-path miss, then the post-IntegrityError re-check finds the winner.
    repo.get_by_client_id.side_effect = [None, winner]
    repo.create.side_effect = IntegrityError("dup", None, Exception("uq_job_client_id"))

    job = await service.create_job(
        JobCreate(customer_name="Yusuf", appliance_type="Split AC", client_id=client_id)
    )

    assert job.id == winner.id
    repo.rollback.assert_awaited_once()
    repo.add_event.assert_not_awaited()


async def test_create_home_visit_stores_home_pin(svc: tuple[JobService, MagicMock]) -> None:
    service, _ = svc
    job = await service.create_job(
        JobCreate(
            job_type="home-visit",
            customer_name="Yusuf",
            customer_address="House 31, DHA",
            appliance_type="Split AC",
            customer_lat=24.8607,
            customer_lng=67.0011,
        )
    )
    assert job.customer_lat == pytest.approx(24.8607)
    assert job.customer_lng == pytest.approx(67.0011)


async def test_create_carry_in_drops_home_pin(svc: tuple[JobService, MagicMock]) -> None:
    """The pin rides the same visit-only rule as the address."""
    service, _ = svc
    job = await service.create_job(
        JobCreate(
            job_type="carry-in",
            customer_name="Zainab",
            appliance_type="Washing Machine",
            customer_lat=24.8607,
            customer_lng=67.0011,
        )
    )
    assert job.customer_lat is None
    assert job.customer_lng is None
    assert job.time_window is None


async def test_create_pickup_delivery_keeps_visit_fields(
    svc: tuple[JobService, MagicMock],
) -> None:
    """Pickup-delivery is a travel job too — the shop drives both ways — so it
    keeps the address, home pin and schedule exactly like a home-visit. Only a
    carry-in drops them."""
    service, _ = svc
    job = await service.create_job(
        JobCreate(
            job_type="pickup-delivery",
            customer_name="Yusuf",
            customer_address="House 31, DHA",
            appliance_type="Washing Machine",
            time_window="11 AM – 1 PM",
            customer_lat=24.8607,
            customer_lng=67.0011,
        )
    )
    assert job.job_type == "pickup-delivery"
    assert job.customer_address == "House 31, DHA"
    assert job.time_window == "11 AM – 1 PM"
    assert job.customer_lat == pytest.approx(24.8607)
    assert job.customer_lng == pytest.approx(67.0011)


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
    # The Phase-4 guard: a normal close also needs the completion form on record.
    done = JobCompletion(
        job_id=job.id,
        labour_rate_paisa=120000,
        time_spent_mins=30,
        fuel_paisa=0,
        submitted_at=datetime.now(UTC),
    )
    done.id = uuid4()
    repo.get_completion.return_value = done
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
    detail = await service.assign_job(job_id=job.id, shop_id="default", tech_id="t3", actor="t1")
    assert detail.assigned_tech_id == "t3"
    assert repo.add_event.await_args.args[0].kind == "assign"


async def test_assign_may_override_an_existing_claim(svc: tuple[JobService, MagicMock]) -> None:
    # Manager reassignment is deliberately unconditional — only the technician
    # free-pick is guarded.
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    detail = await service.assign_job(job_id=job.id, shop_id="default", tech_id="t4", actor="t1")
    assert detail.assigned_tech_id == "t4"


async def test_claim_sets_tech_and_logs_claim_event(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job

    async def _refresh(row: JobRow) -> None:  # the conditional UPDATE wrote the DB
        row.assigned_tech_id = "t2"

    repo.refresh.side_effect = _refresh
    detail = await service.claim_job(job_id=job.id, shop_id="default", tech_id="t2")
    assert detail.assigned_tech_id == "t2"
    repo.try_claim.assert_awaited_once_with(job.id, "t2")
    assert repo.add_event.await_args.args[0].kind == "claim"


async def test_claim_of_a_taken_job_conflicts_with_the_holder_named(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.try_claim.return_value = False  # lost the race / already taken

    async def _refresh(row: JobRow) -> None:
        row.assigned_tech_id = "t9"

    repo.refresh.side_effect = _refresh
    with pytest.raises(JobConflictError, match="already assigned to t9"):
        await service.claim_job(job_id=job.id, shop_id="default", tech_id="t2")
    repo.add_event.assert_not_awaited()


async def test_reclaiming_your_own_job_is_idempotent(svc: tuple[JobService, MagicMock]) -> None:
    # An offline retry of a claim that already landed must succeed quietly —
    # and must not append a duplicate timeline event.
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    detail = await service.claim_job(job_id=job.id, shop_id="default", tech_id="t2")
    assert detail.assigned_tech_id == "t2"
    repo.add_event.assert_not_awaited()


async def test_claiming_a_closed_job_conflicts(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    job.status = "closed"
    repo.get.return_value = job
    with pytest.raises(JobConflictError, match="closed"):
        await service.claim_job(job_id=job.id, shop_id="default", tech_id="t2")
    repo.try_claim.assert_not_awaited()


# ── create: token-collision retry ────────────────────────────────────────────
def _collide_once() -> object:
    """A repo.create side effect: first call hits uq_job_token, second persists."""
    calls = {"n": 0}

    async def _side(job: JobRow) -> JobRow:
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("stmt", {}, Exception("duplicate key uq_job_token"))
        return _persist(job)

    return _side


async def test_create_retries_token_collision(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    repo.next_token.side_effect = [1052, 1053]
    repo.create.side_effect = _collide_once()

    job = await service.create_job(
        JobCreate(customer_name="Abdul", appliance_type="Split AC", problem="x")
    )

    # The second attempt wins with the recomputed token.
    assert job.token == 1053
    repo.rollback.assert_awaited_once()
    assert repo.next_token.await_count == 2


async def test_create_gives_up_after_three_collisions(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    repo.next_token.side_effect = [1052, 1053, 1054]
    repo.create.side_effect = IntegrityError("stmt", {}, Exception("dup"))
    with pytest.raises(IntegrityError):
        await service.create_job(
            JobCreate(customer_name="Abdul", appliance_type="Split AC", problem="x")
        )
    assert repo.rollback.await_count == 3
    repo.add_event.assert_not_awaited()


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
    existing = JobCompletion(job_id=job.id, labour_rate_paisa=120000)
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


async def test_log_payment_recovers_the_concurrent_duplicate_race(
    svc: tuple[JobService, MagicMock],
) -> None:
    """Two concurrent sends of the same client_id: both pass the fast-path
    lookup, the unique constraint catches the loser at flush — which must
    recover as the no-op it is (same pattern as attendance), not surface a 500.
    """
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    cid = uuid4()

    # Fast path sees nothing (we're mid-race) …
    repo.get_payment_by_client.side_effect = [
        None,  # the pre-insert dedup check
        JobPayment(job_id=job.id, client_id=cid, amount_paisa=200000, method="cash"),  # recovery
    ]
    # … and the insert collides on uq_job_payment_client.
    repo.add_payment.side_effect = IntegrityError("stmt", {}, Exception("uq_job_payment_client"))

    detail = await service.log_payment(
        job_id=job.id,
        shop_id="default",
        amount_paisa=200000,
        method="cash",
        client_id=cid,
        actor="t1",
    )

    assert detail.id == job.id
    repo.rollback.assert_awaited_once()
    repo.add_event.assert_not_awaited()  # the winning request wrote the event


async def test_log_payment_reraises_a_non_duplicate_integrity_error(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.get_payment_by_client.return_value = None  # nothing before OR after
    repo.add_payment.side_effect = IntegrityError("stmt", {}, Exception("some other constraint"))

    with pytest.raises(IntegrityError):
        await service.log_payment(
            job_id=job.id,
            shop_id="default",
            amount_paisa=200000,
            method="cash",
            client_id=uuid4(),
            actor="t1",
        )
    repo.rollback.assert_awaited_once()


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


@pytest.mark.parametrize(
    ("kind", "label"),
    [
        ("depart_workshop", "left workshop"),
        ("arrive_customer", "arrived at customer"),
        ("depart_customer", "left customer"),
        ("arrive_workshop", "back at workshop"),
        ("depart_workshop_delivery", "left workshop (delivery)"),
        ("arrive_customer_delivery", "arrived at customer (delivery)"),
    ],
)
async def test_record_location_labels_every_kind(
    svc: tuple[JobService, MagicMock], kind: str, label: str
) -> None:
    """Every punch kind gets an honest timeline label — the old binary ternary
    called a return-leg punch 'arrived at customer'."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    await service.record_location(
        job_id=job.id,
        shop_id="default",
        body=LocationRequest(kind=kind, lat=24.86, lng=67.0, client_id=uuid4()),  # type: ignore[arg-type]
        actor="t1",
    )
    assert label in repo.add_event.await_args.args[0].text


async def test_record_location_trusts_in_window_device_time(
    svc: tuple[JobService, MagicMock],
) -> None:
    """An offline-synced punch keeps its real capture time (re-bucket, never
    reject) — the breadcrumb window-clip depends on the pins' true spread."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    device_time = datetime.now(UTC) - timedelta(hours=3)
    await service.record_location(
        job_id=job.id,
        shop_id="default",
        body=LocationRequest(
            kind="depart_workshop", lat=24.86, lng=67.0, device_time=device_time, client_id=uuid4()
        ),
        actor="t1",
    )
    assert repo.add_location.await_args.args[0].captured_at == device_time


async def test_record_location_rebuckets_stale_device_time(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    stale = datetime.now(UTC) - timedelta(hours=settings.jobs_gps_backdate_ceiling_hours + 5)
    await service.record_location(
        job_id=job.id,
        shop_id="default",
        body=LocationRequest(
            kind="depart_workshop", lat=24.86, lng=67.0, device_time=stale, client_id=uuid4()
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.captured_at != stale  # re-bucketed to receipt time…
    assert stored.captured_at >= datetime.now(UTC) - timedelta(minutes=1)
    assert stored.device_time == stale  # …but the raw clock is kept for audit


# ── Travel breadcrumbs → billable distance ───────────────────────────────────
_T0 = datetime(2026, 7, 10, 9, 0, tzinfo=UTC)


def _now() -> datetime:
    return datetime.now(UTC)


def _sample(
    lat: float,
    lng: float,
    at: datetime,
    *,
    leg: str = "outbound",
    accuracy_m: float | None = 20.0,
    is_mock: bool = False,
) -> JobTravelSample:
    s = JobTravelSample(
        job_id=uuid4(),
        client_id=uuid4(),
        leg=leg,
        lat=lat,
        lng=lng,
        accuracy_m=accuracy_m,
        is_mock=is_mock,
        captured_at=at,
    )
    s.id = uuid4()
    return s


def _drive(n: int, *, start: datetime = _T0, zigzag: bool = False) -> list[JobTravelSample]:
    """``n`` samples heading north from 24.86, one per minute, ~111 m apart
    (0.001° lat). ``zigzag`` swings lng each step so the path-sum lands well
    above the straight line between the endpoints."""
    return [
        _sample(
            24.86 + i * 0.001,
            67.0 + (0.001 if zigzag and i % 2 else 0.0),
            start + timedelta(minutes=i),
        )
        for i in range(n)
    ]


def _pairwise_sum(samples: list[JobTravelSample]) -> float:
    return sum(
        haversine_m(a.lat, a.lng, b.lat, b.lng) for a, b in zip(samples, samples[1:], strict=False)
    )


def test_path_sum_is_sum_of_consecutive_segments() -> None:
    samples = _drive(6)
    assert path_sum_m(samples) == pytest.approx(_pairwise_sum(samples))


def test_path_sum_excludes_untrusted_samples() -> None:
    """Mock fixes and coarse/missing accuracy can't feed money — the good
    neighbours bridge the gap instead."""
    samples = _drive(7)
    samples[2].is_mock = True
    samples[4].accuracy_m = None
    samples[5].accuracy_m = settings.travel_sample_accuracy_ceiling_m + 1
    trusted = [samples[0], samples[1], samples[3], samples[6]]
    # Only 4 trusted → below the minimum → can't be trusted at all.
    assert path_sum_m(samples) is None
    # With one more good sample the path is the bridge over the excluded ones.
    samples.append(_sample(24.867, 67.0, _T0 + timedelta(minutes=7)))
    assert path_sum_m(samples) == pytest.approx(_pairwise_sum([*trusted, samples[-1]]))


def test_path_sum_skips_teleport_and_jitter_segments() -> None:
    samples = _drive(6)
    # Teleport: ~5.5 km in 60 s (~92 m/s) — the segment contributes 0.
    samples.insert(3, _sample(24.91, 67.0, samples[2].captured_at + timedelta(seconds=30)))
    # Jitter: 0 m from its predecessor — also contributes 0.
    samples.append(
        _sample(samples[-1].lat, samples[-1].lng, samples[-1].captured_at + timedelta(minutes=1))
    )
    total = path_sum_m(samples)
    assert total is not None
    # The teleport segment (in AND out) and the jitter segment add nothing, so
    # the total stays below the honest drive's pairwise sum.
    assert total < _pairwise_sum(_drive(6))


def test_path_sum_skips_non_advancing_time() -> None:
    samples = _drive(6)
    dup = _sample(24.868, 67.0, samples[-1].captured_at)  # same clock tick, big jump
    samples.append(dup)
    assert path_sum_m(samples) == pytest.approx(_pairwise_sum(samples[:-1]))


def test_path_sum_none_when_too_sparse() -> None:
    assert path_sum_m(_drive(4)) is None


def _pins(depart_at: datetime, arrive_at: datetime) -> list[JobLocation]:
    depart = _loc("depart_workshop", 24.86, 67.0)
    depart.captured_at = depart_at
    arrive = _loc("arrive_customer", 24.87, 67.0)
    arrive.captured_at = arrive_at
    return [depart, arrive]


def test_derive_route_upgrades_to_breadcrumbs() -> None:
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    samples = _drive(11, zigzag=True)
    route = derive_route(pins, samples, rate_paisa_per_km=2000, circuity_factor=1.35)
    assert route is not None
    assert route.basis == "breadcrumbs"
    expected = path_sum_m(samples)
    assert expected is not None
    assert route.distance_m == pytest.approx(expected)
    assert route.sample_count == 11
    assert route.round_trip_distance_m == pytest.approx(expected * 2)
    # Round ONCE on the doubled distance — never double the rounded paisa.
    assert route.round_trip_fuel_paisa == route_fuel_paisa(expected * 2, 2000)


def test_derive_route_estimates_when_samples_sparse() -> None:
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    straight = haversine_m(24.86, 67.0, 24.87, 67.0)
    route = derive_route(pins, _drive(3), rate_paisa_per_km=2000, circuity_factor=1.35)
    assert route is not None
    assert route.basis == "estimate"
    assert route.distance_m == pytest.approx(straight * 1.35)
    assert route.fuel_paisa == route_fuel_paisa(straight * 1.35, 2000)


def test_derive_route_estimates_when_path_shorter_than_straight() -> None:
    """A 'path' below the straight line is physically impossible without heavy
    sample loss — the estimate is more honest."""
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    clustered = [
        _sample(24.8600 + i * 0.0002, 67.0, _T0 + timedelta(minutes=i)) for i in range(6)
    ]  # ~22 m steps, ~111 m total — far under the ~1112 m straight line
    route = derive_route(pins, clustered, rate_paisa_per_km=2000, circuity_factor=1.35)
    assert route is not None
    assert route.basis == "estimate"


def test_derive_route_clips_samples_to_the_latest_drive() -> None:
    """A rescheduled job driven twice must bill only the latest drive — the
    first attempt's breadcrumbs fall outside the latest punch window."""
    first_drive = _drive(8, start=_T0 - timedelta(hours=3), zigzag=True)
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    route = derive_route(pins, first_drive, rate_paisa_per_km=2000, circuity_factor=1.35)
    assert route is not None
    assert route.basis == "estimate"  # stale samples clipped → too few → estimate
    assert route.sample_count == 0


def test_derive_route_ignores_return_leg_samples() -> None:
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    returning = [
        _sample(24.86 + i * 0.001, 67.0, _T0 + timedelta(minutes=i), leg="return") for i in range(8)
    ]
    route = derive_route(pins, returning, rate_paisa_per_km=2000, circuity_factor=1.35)
    assert route is not None
    assert route.basis == "estimate"
    assert route.sample_count == 0


# ── Workshop-origin fuel fallback (forgot-to-punch robustness) ────────────────
# The workshop fence centre sits at the depart-pin coordinate; the customer is
# ~1112 m north (0.01° lat).
_WORKSHOP = (24.86, 67.0, 150)  # (center_lat, center_lng, radius_m)
_STRAIGHT_WS = haversine_m(24.86, 67.0, 24.87, 67.0)


def _arrive_only(arrive_at: datetime) -> list[JobLocation]:
    arrive = _loc("arrive_customer", 24.87, 67.0)
    arrive.captured_at = arrive_at
    return [arrive]


def test_derive_route_missing_depart_uses_workshop_origin() -> None:
    """Forgot to punch out: only the arrival pin exists. With the workshop
    circle we still bill an honest straight-line estimate from the shop."""
    locations = _arrive_only(_T0 + timedelta(minutes=15))
    route = derive_route(
        locations, [], rate_paisa_per_km=2000, circuity_factor=1.35, workshop=_WORKSHOP
    )
    assert route is not None
    assert route.basis == "estimate"
    assert route.distance_m == pytest.approx(_STRAIGHT_WS * 1.35)
    assert route.sample_count == 0


def test_derive_route_missing_depart_no_workshop_is_none() -> None:
    """No depart pin and no workshop → today's behaviour (no route at all)."""
    locations = _arrive_only(_T0 + timedelta(minutes=15))
    assert derive_route(locations, [], rate_paisa_per_km=2000, circuity_factor=1.35) is None


def test_derive_route_colocated_depart_falls_back_to_workshop() -> None:
    """Both ends punched at the customer (bogus depart): without the fallback
    the straight line collapses to ~0 and bills no fuel. The workshop origin
    restores an honest estimate."""
    depart = _loc("depart_workshop", 24.87, 67.0)  # co-located with the customer
    depart.captured_at = _T0 - timedelta(minutes=1)
    arrive = _loc("arrive_customer", 24.87, 67.0)
    arrive.captured_at = _T0 + timedelta(minutes=15)
    route = derive_route(
        [depart, arrive], [], rate_paisa_per_km=2000, circuity_factor=1.35, workshop=_WORKSHOP
    )
    assert route is not None
    assert route.basis == "estimate"
    assert route.distance_m == pytest.approx(_STRAIGHT_WS * 1.35)  # not ~0


def test_derive_route_normal_depart_unaffected_by_workshop() -> None:
    """A depart punch at the workshop is trusted as the origin — passing the
    circle changes nothing for the honest path."""
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    route = derive_route(
        pins, _drive(3), rate_paisa_per_km=2000, circuity_factor=1.35, workshop=_WORKSHOP
    )
    assert route is not None
    assert route.basis == "estimate"
    assert route.distance_m == pytest.approx(_STRAIGHT_WS * 1.35)


def test_derive_route_breadcrumbs_still_win_with_workshop() -> None:
    """Genuine breadcrumbs from a workshop-anchored depart still upgrade the
    basis — the fallback never suppresses a real trail."""
    pins = _pins(_T0 - timedelta(minutes=1), _T0 + timedelta(minutes=15))
    route = derive_route(
        pins,
        _drive(11, zigzag=True),
        rate_paisa_per_km=2000,
        circuity_factor=1.35,
        workshop=_WORKSHOP,
    )
    assert route is not None
    assert route.basis == "breadcrumbs"
    assert route.sample_count == 11


async def test_record_travel_samples_requires_assignment(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    batch = TravelSampleBatch(
        samples=[TravelSampleIn(client_id=uuid4(), lat=24.86, lng=67.0, captured_at=_now())]
    )
    with pytest.raises(JobForbiddenError):
        await service.record_travel_samples(
            job_id=job.id, shop_id="default", body=batch, actor="t1", actor_is_manager=False
        )
    repo.create_travel_samples.assert_not_awaited()


async def test_record_travel_samples_manager_bypasses_assignment(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    repo.create_travel_samples.return_value = 1
    batch = TravelSampleBatch(
        samples=[TravelSampleIn(client_id=uuid4(), lat=24.86, lng=67.0, captured_at=_now())]
    )
    resp = await service.record_travel_samples(
        job_id=job.id, shop_id="default", body=batch, actor="m1", actor_is_manager=True
    )
    assert resp.accepted == 1
    repo.add_event.assert_not_awaited()  # telemetry, not a timeline moment


async def test_record_travel_samples_rejects_stale_and_counts_dedupe(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t1"
    repo.get.return_value = job
    repo.create_travel_samples.return_value = 1  # of the 2 fresh, 1 was already stored
    stale_at = _now() - timedelta(hours=settings.jobs_gps_backdate_ceiling_hours + 2)
    batch = TravelSampleBatch(
        samples=[
            TravelSampleIn(client_id=uuid4(), lat=24.86, lng=67.0, captured_at=_now()),
            TravelSampleIn(client_id=uuid4(), lat=24.861, lng=67.0, captured_at=_now()),
            TravelSampleIn(client_id=uuid4(), lat=24.862, lng=67.0, captured_at=stale_at),
        ]
    )
    resp = await service.record_travel_samples(
        job_id=job.id, shop_id="default", body=batch, actor="t1", actor_is_manager=False
    )
    assert resp.rejected == 1  # the stale one was dropped, never stored
    assert resp.accepted == 1
    assert resp.deduped == 1  # 2 fresh − 1 newly stored
    rows = repo.create_travel_samples.await_args.args[0]
    assert len(rows) == 2  # the stale sample never reached the repository
    assert all(r["recorded_by"] == "t1" for r in rows)


# ── Bill fuel auto-fill ──────────────────────────────────────────────────────
async def test_completion_autofills_round_trip_fuel_from_route(
    svc: tuple[JobService, MagicMock],
) -> None:
    """Omitted fuel → the server bills the derived ROUND TRIP (outbound × 2)
    and persists the provenance."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_locations.return_value = _pins(_now() - timedelta(hours=1), _now())

    body = CompletionRequest(
        materials=[MaterialIn(name="Relay", qty=2, unit_paisa=60000)],  # 120000
        time_spent_mins=60,  # labour = 120000
    )
    detail = await service.submit_completion(
        job_id=job.id, shop_id="default", body=body, actor="t1"
    )

    straight = haversine_m(24.86, 67.0, 24.87, 67.0)
    one_way = straight * settings.fuel_route_circuity_factor
    expected_fuel = route_fuel_paisa(one_way * 2, settings.fuel_rate_paisa_per_km)
    assert detail.bill_original_paisa == 240000 + expected_fuel

    completion = repo.add_completion.await_args.args[0]
    assert completion.fuel_paisa == expected_fuel
    assert completion.fuel_basis == "estimate"
    assert completion.fuel_distance_m == pytest.approx(one_way * 2)
    assert completion.fuel_rate_paisa_per_km == settings.fuel_rate_paisa_per_km  # snapshot

    payload = repo.add_event.await_args.args[0].payload
    assert payload["fuel_basis"] == "estimate"
    assert payload["fuel_paisa"] == expected_fuel


async def test_completion_explicit_zero_fuel_wins(svc: tuple[JobService, MagicMock]) -> None:
    """An explicit 0 is the tech's call — auto-fill must NOT overwrite it even
    when a route exists."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_locations.return_value = _pins(_now() - timedelta(hours=1), _now())

    body = CompletionRequest(time_spent_mins=60, fuel_paisa=0)
    detail = await service.submit_completion(
        job_id=job.id, shop_id="default", body=body, actor="t1"
    )
    assert detail.bill_original_paisa == 120000  # labour only
    completion = repo.add_completion.await_args.args[0]
    assert completion.fuel_paisa == 0
    assert completion.fuel_basis == "manual"
    assert completion.fuel_distance_m is None


async def test_completion_autofill_zero_without_route(svc: tuple[JobService, MagicMock]) -> None:
    """Carry-in (no pins): omitted fuel bills 0 with no basis — nothing to
    derive from, and old clients keep today's behaviour bit-for-bit."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job  # fixture's list_locations is []

    body = CompletionRequest(time_spent_mins=60)
    detail = await service.submit_completion(
        job_id=job.id, shop_id="default", body=body, actor="t1"
    )
    assert detail.bill_original_paisa == 120000
    completion = repo.add_completion.await_args.args[0]
    assert completion.fuel_paisa == 0
    assert completion.fuel_basis is None
    repo.list_travel_samples.assert_not_awaited()  # no pins → the query is skipped


async def test_completion_uses_workshop_origin_when_depart_missing(
    svc: tuple[JobService, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Forgot to punch out — only the arrival pin exists. The completion fuel
    falls back to the workshop-origin estimate instead of silently billing 0."""
    from app.features.jobs import service as jobs_service

    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    arrive = _loc("arrive_customer", 24.87, 67.0)
    arrive.captured_at = _now()
    repo.list_locations.return_value = [arrive]  # no depart pin
    monkeypatch.setattr(jobs_service, "workshop_circle", AsyncMock(return_value=(24.86, 67.0, 150)))

    body = CompletionRequest(time_spent_mins=60)  # fuel omitted → auto-derive
    await service.submit_completion(job_id=job.id, shop_id="default", body=body, actor="t1")

    completion = repo.add_completion.await_args.args[0]
    assert completion.fuel_basis == "estimate"
    assert completion.fuel_paisa > 0  # 0 without the workshop fallback
    repo.list_travel_samples.assert_not_awaited()  # no depart pin → no breadcrumb query


async def test_completion_resubmit_derives_with_the_snapshot_rate(
    svc: tuple[JobService, MagicMock],
) -> None:
    """The rate pinned at first submission — not today's settings — prices a
    re-derived fuel line, exactly like labour_rate_paisa."""
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_locations.return_value = _pins(_now() - timedelta(hours=1), _now())
    snapshot_rate = settings.fuel_rate_paisa_per_km * 2  # pretend settings later doubled
    existing = JobCompletion(
        job_id=job.id, labour_rate_paisa=120000, fuel_rate_paisa_per_km=snapshot_rate
    )
    existing.id = uuid4()
    repo.get_completion.return_value = existing

    await service.submit_completion(
        job_id=job.id, shop_id="default", body=CompletionRequest(), actor="t1"
    )

    straight = haversine_m(24.86, 67.0, 24.87, 67.0)
    one_way = straight * settings.fuel_route_circuity_factor
    assert existing.fuel_paisa == route_fuel_paisa(one_way * 2, snapshot_rate)


# ── Punch verdicts (0037) — flag-never-block ─────────────────────────────────
def _pinned_job(lat: float = 24.86, lng: float = 67.0) -> JobRow:
    job = _open_job()
    job.customer_lat = lat
    job.customer_lng = lng
    return job


async def test_arrival_inside_radius_is_verified(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _pinned_job()
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer", lat=24.861, lng=67.0, accuracy_m=20, client_id=uuid4()
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.distance_m == pytest.approx(haversine_m(24.861, 67.0, 24.86, 67.0))
    assert stored.verified is True
    assert "off-pin" not in repo.add_event.await_args.args[0].text


async def test_arrival_confidently_far_is_flagged_never_blocked(
    svc: tuple[JobService, MagicMock],
) -> None:
    """>250 m with a confident fix → verified False + an honest timeline line.
    The punch is still recorded — the server never rejects over the verdict."""
    service, repo = svc
    repo.get.return_value = _pinned_job()
    detail = await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer", lat=24.88, lng=67.0, accuracy_m=20, client_id=uuid4()
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.verified is False
    assert stored.distance_m > settings.jobs_arrival_radius_m
    text = repo.add_event.await_args.args[0].text
    assert "off-pin" in text
    assert "km away" in text
    assert detail is not None  # recorded, not rejected


async def test_arrival_coarse_fix_cannot_support_a_verdict(
    svc: tuple[JobService, MagicMock],
) -> None:
    """A fix blurrier than the ceiling says nothing either way → verified NULL,
    but the distance is still stored as evidence."""
    service, repo = svc
    repo.get.return_value = _pinned_job()
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer",
            lat=24.88,
            lng=67.0,
            accuracy_m=settings.jobs_punch_accuracy_ceiling_m + 50,
            client_id=uuid4(),
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.verified is None
    assert stored.distance_m is not None
    assert "off-pin" not in repo.add_event.await_args.args[0].text


async def test_arrival_mock_fix_is_unjudged_but_distance_kept(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _pinned_job()
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer",
            lat=24.88,
            lng=67.0,
            accuracy_m=10,
            is_mock=True,
            client_id=uuid4(),
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.verified is None  # a spoofed fix can't verify anything
    assert stored.distance_m is not None  # ...but the claim is kept as evidence
    assert "mock" in repo.add_event.await_args.args[0].text


async def test_arrival_without_pin_is_unjudged(svc: tuple[JobService, MagicMock]) -> None:
    """No customer pin on the job → nothing to judge against (pre-0036 rows,
    carry-in conversions). Behaviour is exactly pre-0037."""
    service, repo = svc
    repo.get.return_value = _open_job()  # no customer_lat/lng
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="arrive_customer", lat=24.88, lng=67.0, accuracy_m=10, client_id=uuid4()
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.distance_m is None
    assert stored.verified is None


async def test_workshop_punch_judged_against_fence_with_radius_floor(
    svc: tuple[JobService, MagicMock], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Workshop-side punches use the attendance fence — with the arrival-radius
    floor, so a tight fence doesn't flag the parking lane across the road."""
    from app.features.jobs import service as jobs_service

    service, repo = svc
    repo.get.return_value = _open_job()
    monkeypatch.setattr(jobs_service, "workshop_circle", AsyncMock(return_value=(24.86, 67.0, 150)))
    # ~222 m from the fence centre: outside the 150 m fence but inside the
    # 250 m floor → verified.
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="depart_workshop", lat=24.862, lng=67.0, accuracy_m=15, client_id=uuid4()
        ),
        actor="t1",
    )
    assert repo.add_location.await_args.args[0].verified is True

    # ~555 m away → confidently off-site.
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="depart_workshop", lat=24.865, lng=67.0, accuracy_m=15, client_id=uuid4()
        ),
        actor="t1",
    )
    assert repo.add_location.await_args.args[0].verified is False
    assert "off-pin" in repo.add_event.await_args.args[0].text


async def test_workshop_punch_unjudged_without_fence(
    svc: tuple[JobService, MagicMock],
) -> None:
    """No configured fence (workshop_circle unavailable) → unjudged, never an
    error in the punch path."""
    service, repo = svc
    repo.get.return_value = _open_job()
    await service.record_location(
        job_id=uuid4(),
        shop_id="default",
        body=LocationRequest(
            kind="depart_workshop", lat=24.86, lng=67.0, accuracy_m=15, client_id=uuid4()
        ),
        actor="t1",
    )
    stored = repo.add_location.await_args.args[0]
    assert stored.distance_m is None
    assert stored.verified is None


# ── Customer pin (0037) ──────────────────────────────────────────────────────
async def test_set_customer_pin_sets_and_audits(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t1"
    repo.get.return_value = job
    detail = await service.set_customer_pin(
        job_id=job.id,
        shop_id="default",
        lat=24.8607,
        lng=67.0011,
        actor="t1",
        actor_is_manager=False,
    )
    assert detail.customer_lat == 24.8607
    assert detail.customer_lng == 67.0011
    event = repo.add_event.await_args.args[0]
    assert event.kind == "pin"
    assert "set" in event.text
    assert event.payload == {"lat": 24.8607, "lng": 67.0011, "prev_lat": None, "prev_lng": None}


async def test_set_customer_pin_move_keeps_prev_in_payload(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _pinned_job(24.86, 67.0)
    job.assigned_tech_id = "t1"
    repo.get.return_value = job
    await service.set_customer_pin(
        job_id=job.id,
        shop_id="default",
        lat=24.87,
        lng=67.01,
        actor="t1",
        actor_is_manager=False,
    )
    event = repo.add_event.await_args.args[0]
    assert "moved" in event.text
    assert event.payload["prev_lat"] == 24.86
    assert event.payload["prev_lng"] == 67.0


async def test_set_customer_pin_same_coords_replay_is_a_no_op(
    svc: tuple[JobService, MagicMock],
) -> None:
    """The outbox replaying the identical pin (lost response) must not append
    a duplicate timeline event."""
    service, repo = svc
    job = _pinned_job(24.86, 67.0)
    job.assigned_tech_id = "t1"
    repo.get.return_value = job
    detail = await service.set_customer_pin(
        job_id=job.id,
        shop_id="default",
        lat=24.86,
        lng=67.0,
        actor="t1",
        actor_is_manager=False,
    )
    assert detail.customer_lat == 24.86
    repo.add_event.assert_not_awaited()


async def test_set_customer_pin_forbidden_for_unassigned_tech(
    svc: tuple[JobService, MagicMock],
) -> None:
    """The pin anchors arrival verdicts + the fuel line — not a free-for-all
    (deliberately stricter than record_location's open punch rail)."""
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    with pytest.raises(JobForbiddenError):
        await service.set_customer_pin(
            job_id=job.id,
            shop_id="default",
            lat=24.86,
            lng=67.0,
            actor="t1",
            actor_is_manager=False,
        )
    repo.add_event.assert_not_awaited()


async def test_set_customer_pin_manager_bypasses_assignment(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    job.assigned_tech_id = "t2"
    repo.get.return_value = job
    detail = await service.set_customer_pin(
        job_id=job.id,
        shop_id="default",
        lat=24.86,
        lng=67.0,
        actor="m1",
        actor_is_manager=True,
    )
    assert detail.customer_lat == 24.86


async def test_set_customer_pin_rejects_carry_in(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    job.job_type = "carry-in"
    job.assigned_tech_id = "t1"
    repo.get.return_value = job
    with pytest.raises(JobActionError):
        await service.set_customer_pin(
            job_id=job.id,
            shop_id="default",
            lat=24.86,
            lng=67.0,
            actor="t1",
            actor_is_manager=False,
        )


# ── Trail read + decimation (0037) ───────────────────────────────────────────
def test_decimate_trail_passthrough_under_budget() -> None:
    samples = _drive(10)
    assert decimate_trail(samples, 1000) is samples


def test_decimate_trail_keeps_shape_and_endpoints_per_leg() -> None:
    """A big outbound + a small return thinned together: both legs keep their
    first/last points, order is preserved, and the result lands near budget."""
    outbound = _drive(300)  # one per minute → ends at _T0 + 299 min
    ret = [
        _sample(24.9 - i * 0.001, 67.0, _T0 + timedelta(hours=6, minutes=i), leg="return")
        for i in range(30)
    ]
    samples = outbound + ret
    kept = decimate_trail(samples, 100)
    assert 100 <= len(kept) <= 110  # per-leg floors/rounding may slightly exceed
    assert kept[0] is outbound[0]
    assert outbound[-1] in kept
    assert ret[0] in kept
    assert ret[-1] in kept
    times = [s.captured_at for s in kept]
    assert times == sorted(times)  # original order preserved


def test_decimate_trail_short_leg_never_dropped() -> None:
    """Proportional budgeting must not starve a 2-point leg out of existence."""
    outbound = _drive(500)
    ret = [
        _sample(24.9, 67.0, _T0 + timedelta(hours=2), leg="return"),
        _sample(24.89, 67.0, _T0 + timedelta(hours=2, minutes=1), leg="return"),
    ]
    kept = decimate_trail(outbound + ret, 50)
    assert ret[0] in kept
    assert ret[1] in kept


async def test_travel_trail_filters_leg_and_reports_counts(
    svc: tuple[JobService, MagicMock],
) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    outbound = _drive(6)
    ret = [_sample(24.9, 67.0, _T0 + timedelta(hours=2), leg="return")]
    repo.list_travel_samples.return_value = outbound + ret

    trail = await service.travel_trail(
        job_id=job.id, shop_id="default", leg="outbound", max_points=1000
    )
    assert trail.total == 6
    assert trail.returned == 6
    assert all(s.leg == "outbound" for s in trail.samples)

    trail = await service.travel_trail(job_id=job.id, shop_id="default", leg=None, max_points=1000)
    assert trail.total == 7


async def test_travel_trail_decimates_to_budget(svc: tuple[JobService, MagicMock]) -> None:
    service, repo = svc
    job = _open_job()
    repo.get.return_value = job
    repo.list_travel_samples.return_value = _drive(200)
    trail = await service.travel_trail(job_id=job.id, shop_id="default", leg=None, max_points=50)
    assert trail.total == 200
    assert trail.returned < 200
    assert trail.returned == len(trail.samples)
    assert trail.samples[0].captured_at == _T0  # endpoint kept
