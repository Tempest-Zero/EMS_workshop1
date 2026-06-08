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
from app.features.jobs.router import get_media_service, get_service
from app.features.jobs.schemas import Job, JobDetail
from app.features.jobs.service import JobActionError, JobNotFoundError, JobService
from app.features.media.service import MediaService
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


@pytest_asyncio.fixture
async def client(
    fake_service: AsyncMock, fake_session: AsyncMock, fake_media: AsyncMock
) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(JobService, fake_service)
    app.dependency_overrides[get_media_service] = lambda: cast(MediaService, fake_media)
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
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.assign_job.return_value = _detail(assigned_tech_id="t3")
    resp = await client.post(f"/api/jobs/{uuid4()}/assign", json={"tech_id": "t3"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned_tech_id"] == "t3"
    fake_session.commit.assert_awaited()


async def test_assign_rejects_missing_tech(client: AsyncClient) -> None:
    resp = await client.post(f"/api/jobs/{uuid4()}/assign", json={})
    assert resp.status_code == 422


async def test_claim_returns_200_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.assign_job.return_value = _detail(assigned_tech_id="t1")
    resp = await client.post(f"/api/jobs/{uuid4()}/claim")
    assert resp.status_code == 200, resp.text
    assert resp.json()["assigned_tech_id"] == "t1"
    fake_session.commit.assert_awaited()


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
