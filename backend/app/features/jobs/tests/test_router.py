"""Router-level tests for the jobs slice. Service + session + auth are overridden
with fakes so no DB round-trip happens (mirrors the other slices)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.features.jobs.router import get_service
from app.features.jobs.schemas import Job, JobDetail, TravelSampleBatchResponse
from app.features.jobs.service import (
    JobActionError,
    JobConflictError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
)
from app.features.media.deps import get_media_service
from app.features.media.service import MediaService
from app.features.notifications.deps import get_notification_service
from app.features.notifications.service import NotificationService
from app.main import app

_FAKE_PRINCIPAL = Principal(tech_id="t1", role="manager", name="Test Manager")


def _job() -> Job:
    now = datetime(2026, 6, 6, 10, 0, tzinfo=UTC)
    return Job(
        id=uuid4(),
        token=1052,
        shop_id="default",
        status="open",
        job_type="carry-in",
        customer_name="Abdul Rehman",
        appliance_type="Split AC",
        problem="not cooling",
        abandoned=False,
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=JobService)


@pytest.fixture
def fake_session() -> AsyncMock:
    session = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest.fixture
def fake_media() -> AsyncMock:
    return AsyncMock(spec=MediaService)


@pytest.fixture
def fake_notifications() -> AsyncMock:
    return AsyncMock(spec=NotificationService)


@pytest_asyncio.fixture
async def client(
    fake_service: AsyncMock,
    fake_session: AsyncMock,
    fake_media: AsyncMock,
    fake_notifications: AsyncMock,
) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(JobService, fake_service)
    app.dependency_overrides[get_media_service] = lambda: cast(MediaService, fake_media)
    app.dependency_overrides[get_notification_service] = lambda: cast(
        NotificationService, fake_notifications
    )
    app.dependency_overrides[get_session] = lambda: fake_session
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_list_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.list_jobs.return_value = []
    resp = await client.get("/api/jobs?status=open")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_create_returns_201_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.create_job.return_value = _job()
    resp = await client.post(
        "/api/jobs",
        json={"customer_name": "Abdul Rehman", "appliance_type": "Split AC", "problem": "x"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["token"] == 1052
    fake_session.commit.assert_awaited()


async def test_create_rejects_missing_customer(client: AsyncClient) -> None:
    resp = await client.post("/api/jobs", json={"appliance_type": "Split AC"})
    assert resp.status_code == 422


async def test_get_unknown_returns_404(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.get_job.side_effect = JobNotFoundError("nope")
    resp = await client.get(f"/api/jobs/{uuid4()}")
    assert resp.status_code == 404


async def test_jobs_require_auth(client: AsyncClient) -> None:
    # Drop the auth override so the real guard runs: no token → 401.
    app.dependency_overrides.pop(get_current_principal, None)
    resp = await client.get("/api/jobs")
    assert resp.status_code == 401


def _detail(**over: object) -> JobDetail:
    return JobDetail(**{**_job().model_dump(), **over}, events=[])


async def test_add_note_returns_201_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.add_note.return_value = _detail()
    resp = await client.post(f"/api/jobs/{uuid4()}/notes", json={"text": "check the capacitor"})
    assert resp.status_code == 201, resp.text
    fake_session.commit.assert_awaited()


async def test_add_note_rejects_empty_text(client: AsyncClient) -> None:
    resp = await client.post(f"/api/jobs/{uuid4()}/notes", json={"text": ""})
    assert resp.status_code == 422


async def test_transition_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.transition.return_value = _detail(status="ready")
    resp = await client.post(f"/api/jobs/{uuid4()}/transition", json={"action": "ready"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "ready"


async def test_transition_action_error_returns_400(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.transition.side_effect = JobActionError("abandon requires a reason")
    resp = await client.post(f"/api/jobs/{uuid4()}/transition", json={"action": "abandon"})
    assert resp.status_code == 400


async def test_close_without_closing_video_returns_400(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    # The service enforces the closing-video gate; the router maps it to a 400.
    fake_service.transition.side_effect = JobActionError("a closing video is required to close")
    resp = await client.post(f"/api/jobs/{uuid4()}/transition", json={"action": "close"})
    assert resp.status_code == 400


async def test_assign_returns_200_and_commits(
    client: AsyncClient,
    fake_service: AsyncMock,
    fake_session: AsyncMock,
    fake_notifications: AsyncMock,
) -> None:
    fake_service.assign_job.return_value = _detail(assigned_tech_id="t3")
    resp = await client.post(f"/api/jobs/{uuid4()}/assign", json={"tech_id": "t3"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned_tech_id"] == "t3"
    fake_session.commit.assert_awaited()
    # The assigned tech gets a push (best-effort).
    fake_notifications.notify_assignment.assert_awaited_once()


async def test_assign_rejects_missing_tech(client: AsyncClient) -> None:
    resp = await client.post(f"/api/jobs/{uuid4()}/assign", json={})
    assert resp.status_code == 422


async def test_assign_is_manager_only(client: AsyncClient) -> None:
    # Assignment is a manager prerogative — a technician's token is refused (403).
    # The fixture installs a manager principal; override it with a tech here.
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t2", role="tech", name="Tech"
    )
    resp = await client.post(f"/api/jobs/{uuid4()}/assign", json={"tech_id": "t3"})
    assert resp.status_code == 403, resp.text


async def test_claim_returns_200_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.claim_job.return_value = _detail(assigned_tech_id="t1")
    resp = await client.post(f"/api/jobs/{uuid4()}/claim")
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned_tech_id"] == "t1"
    fake_session.commit.assert_awaited()


async def test_claim_of_a_taken_job_is_409(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.claim_job.side_effect = JobConflictError("already assigned to t9")
    resp = await client.post(f"/api/jobs/{uuid4()}/claim")
    assert resp.status_code == 409, resp.text
    assert "already assigned" in resp.json()["detail"]


async def test_submit_completion_returns_200_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.submit_completion.return_value = _detail(
        bill_original_paisa=290000, bill_status="generated"
    )
    resp = await client.post(
        f"/api/jobs/{uuid4()}/completion",
        json={
            "materials": [{"name": "Relay", "qty": 2, "unit_paisa": 60000}],
            "time_spent_mins": 60,
            "fuel_paisa": 50000,
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["bill_original_paisa"] == 290000
    fake_session.commit.assert_awaited()


async def test_completion_rejects_negative_money(client: AsyncClient) -> None:
    resp = await client.post(
        f"/api/jobs/{uuid4()}/completion",
        json={"materials": [{"name": "x", "qty": 1, "unit_paisa": -5}]},
    )
    assert resp.status_code == 422


async def test_negotiate_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.negotiate_bill.return_value = _detail(
        bill_original_paisa=500000, bill_negotiated_paisa=420000, bill_status="negotiated"
    )
    resp = await client.post(f"/api/jobs/{uuid4()}/bill/negotiate", json={"amount_paisa": 420000})
    assert resp.status_code == 200, resp.text
    assert resp.json()["bill_negotiated_paisa"] == 420000


async def test_negotiate_without_bill_returns_400(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.negotiate_bill.side_effect = JobActionError("no bill yet")
    resp = await client.post(f"/api/jobs/{uuid4()}/bill/negotiate", json={"amount_paisa": 1000})
    assert resp.status_code == 400


async def test_log_payment_returns_200_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.log_payment.return_value = _detail(received_paisa=200000, balance_paisa=300000)
    resp = await client.post(
        f"/api/jobs/{uuid4()}/payments",
        json={"amount_paisa": 200000, "method": "cash", "client_id": str(uuid4())},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["received_paisa"] == 200000
    fake_session.commit.assert_awaited()


async def test_payment_rejects_zero_amount(client: AsyncClient) -> None:
    resp = await client.post(
        f"/api/jobs/{uuid4()}/payments",
        json={"amount_paisa": 0, "method": "cash", "client_id": str(uuid4())},
    )
    assert resp.status_code == 422  # amount_paisa must be > 0


async def test_void_payment_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.void_payment.return_value = _detail(received_paisa=0, balance_paisa=500000)
    resp = await client.post(
        f"/api/jobs/{uuid4()}/payments/{uuid4()}/void", json={"reason": "duplicate"}
    )
    assert resp.status_code == 200, resp.text


async def test_record_location_returns_200_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.record_location.return_value = _detail()
    resp = await client.post(
        f"/api/jobs/{uuid4()}/locations",
        json={
            "kind": "depart_workshop",
            "lat": 24.8607,
            "lng": 67.0011,
            "is_mock": False,
            "client_id": str(uuid4()),
        },
    )
    assert resp.status_code == 200, resp.text
    fake_session.commit.assert_awaited()


async def test_record_location_rejects_bad_lat(client: AsyncClient) -> None:
    resp = await client.post(
        f"/api/jobs/{uuid4()}/locations",
        json={"kind": "depart_workshop", "lat": 999, "lng": 0, "client_id": str(uuid4())},
    )
    assert resp.status_code == 422  # lat out of [-90, 90]


async def test_record_location_rejects_bad_kind(client: AsyncClient) -> None:
    resp = await client.post(
        f"/api/jobs/{uuid4()}/locations",
        json={"kind": "teleport", "lat": 24.0, "lng": 67.0, "client_id": str(uuid4())},
    )
    assert resp.status_code == 422


def _travel_sample(**over: object) -> dict[str, object]:
    return {
        "client_id": str(uuid4()),
        "leg": "outbound",
        "lat": 24.86,
        "lng": 67.0,
        "accuracy_m": 15,
        "captured_at": "2026-07-10T09:00:00Z",
        **over,
    }


async def test_record_travel_samples_returns_201_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.record_travel_samples.return_value = TravelSampleBatchResponse(
        accepted=10, deduped=0, rejected=0, route=None
    )
    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples",
        json={"samples": [_travel_sample(), _travel_sample()]},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert (body["accepted"], body["deduped"], body["rejected"]) == (10, 0, 0)
    fake_session.commit.assert_awaited()


async def test_travel_samples_batch_of_101_is_422(client: AsyncClient) -> None:
    # An oversized batch is a client bug (the queue flushes ≤100 at a time).
    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples",
        json={"samples": [_travel_sample() for _ in range(101)]},
    )
    assert resp.status_code == 422


async def test_travel_samples_reject_bad_lat_and_leg(client: AsyncClient) -> None:
    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples",
        json={"samples": [_travel_sample(lat=999)]},
    )
    assert resp.status_code == 422  # lat out of [-90, 90]

    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples",
        json={"samples": [_travel_sample(leg="teleport")]},
    )
    assert resp.status_code == 422  # leg not in the vocabulary


async def test_travel_samples_on_someone_elses_job_is_403(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.record_travel_samples.side_effect = JobForbiddenError("not your job")
    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples", json={"samples": [_travel_sample()]}
    )
    assert resp.status_code == 403, resp.text


async def test_travel_samples_unknown_job_is_404(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.record_travel_samples.side_effect = JobNotFoundError("nope")
    resp = await client.post(
        f"/api/jobs/{uuid4()}/travel-samples", json={"samples": [_travel_sample()]}
    )
    assert resp.status_code == 404


async def test_evidence_gaps_is_manager_only_and_not_swallowed_by_job_route(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    # A technician token is forbidden (403, not a UUID-parse 422 — proving the
    # static route wins over GET /{job_id}).
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Bilal"
    )
    resp = await client.get("/api/jobs/evidence-gaps")
    assert resp.status_code == 403

    # The manager gets the list straight from the service.
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    fake_service.evidence_gaps = AsyncMock(return_value=[])
    resp = await client.get("/api/jobs/evidence-gaps")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_money_guard_conflicts_map_to_409(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    # The Phase-4 guards raise JobConflictError from transition / completion /
    # negotiate — each endpoint must answer 409 (the unit gap that let CI's
    # integration suite catch a leaked exception).
    fake_service.transition = AsyncMock(side_effect=JobConflictError("close requires the form"))
    fake_service.submit_completion = AsyncMock(side_effect=JobConflictError("job is closed"))
    fake_service.negotiate_bill = AsyncMock(side_effect=JobConflictError("job is closed"))
    job_id = uuid4()

    resp = await client.post(f"/api/jobs/{job_id}/transition", json={"action": "close"})
    assert resp.status_code == 409

    resp = await client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [], "time_spent_mins": 0, "fuel_paisa": 0},
    )
    assert resp.status_code == 409

    resp = await client.post(f"/api/jobs/{job_id}/bill/negotiate", json={"amount_paisa": 1000})
    assert resp.status_code == 409
