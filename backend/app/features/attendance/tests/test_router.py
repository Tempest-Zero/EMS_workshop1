"""Router-level tests. Overrides `get_service` + `get_session` with fakes so no
DB or R2 round-trip happens (mirrors the media slice)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.features.attendance.router import get_service
from app.features.attendance.schemas import (
    ActiveGeofence,
    Board,
    PayrollDay,
    PayrollExport,
    PresenceResponse,
    PunchResponse,
    TodayStatus,
)
from app.features.attendance.service import (
    AttendanceNotFoundError,
    AttendanceService,
    SelfieTooLargeError,
)
from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.main import app

_FAKE_PRINCIPAL = Principal(tech_id="t1", role="manager", name="Test Manager")


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=AttendanceService)


@pytest.fixture
def fake_session() -> AsyncMock:
    session = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest_asyncio.fixture
async def client(fake_service: AsyncMock, fake_session: AsyncMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(AttendanceService, fake_service)
    app.dependency_overrides[get_session] = lambda: fake_session
    # Treat the caller as authenticated; the real guard is exercised separately.
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_post_punch_returns_201_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    event_id, client_id = uuid4(), uuid4()
    fake_service.record_punch.return_value = PunchResponse(
        event_id=event_id,
        client_id=client_id,
        server_time=datetime(2026, 6, 3, 4, 0, tzinfo=UTC),
        inside_geofence=True,
        distance_m=12.0,
        is_mock_location=False,
        drift_seconds=3,
        drift_flagged=False,
    )

    resp = await client.post(
        "/api/attendance/punches",
        json={"client_id": str(client_id), "tech_id": "t1", "kind": "clock_in"},
    )

    assert resp.status_code == 201
    assert resp.json()["event_id"] == str(event_id)
    fake_session.commit.assert_awaited()


async def test_post_presence_returns_201_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    event_id, client_id = uuid4(), uuid4()
    fake_service.record_presence.return_value = PresenceResponse(
        event_id=event_id,
        client_id=client_id,
        server_time=datetime(2026, 6, 3, 4, 0, tzinfo=UTC),
        kind="arrive",
        inside_geofence=True,
        distance_m=8.0,
    )

    resp = await client.post(
        "/api/attendance/presence",
        json={"client_id": str(client_id), "tech_id": "t1", "kind": "arrive"},
    )

    assert resp.status_code == 201
    assert resp.json()["event_id"] == str(event_id)
    assert resp.json()["kind"] == "arrive"
    fake_session.commit.assert_awaited()


async def test_post_presence_rejects_invalid_kind(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/attendance/presence",
        json={"client_id": str(uuid4()), "tech_id": "t1", "kind": "clock_in"},
    )
    assert resp.status_code == 422


async def test_tech_cannot_log_presence_for_another_tech(client: AsyncClient) -> None:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    resp = await client.post(
        "/api/attendance/presence",
        json={"client_id": str(uuid4()), "tech_id": "t9", "kind": "arrive"},
    )
    assert resp.status_code == 403


async def test_active_geofence_readable_by_tech(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    # NOT manager-gated: a plain tech must be able to read the fence to monitor.
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    fake_service.active_geofence.return_value = ActiveGeofence(
        name="Workshop", center_lat=24.86, center_lng=67.0, radius_m=80, is_active=True
    )
    resp = await client.get("/api/attendance/geofence/active")
    assert resp.status_code == 200
    assert resp.json()["radius_m"] == 80


async def test_post_punch_rejects_invalid_kind(client: AsyncClient) -> None:
    resp = await client.post(
        "/api/attendance/punches",
        json={"client_id": str(uuid4()), "tech_id": "t1", "kind": "sideways"},
    )
    assert resp.status_code == 422


async def test_tech_cannot_punch_as_another_tech(client: AsyncClient) -> None:
    # A non-manager principal punching with a different tech_id → 403.
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    resp = await client.post(
        "/api/attendance/punches",
        json={"client_id": str(uuid4()), "tech_id": "t9", "kind": "clock_in"},
    )
    assert resp.status_code == 403


async def test_tech_can_punch_as_self(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    cid = uuid4()
    fake_service.record_punch.return_value = PunchResponse(
        event_id=uuid4(),
        client_id=cid,
        server_time=datetime(2026, 6, 3, 4, 0, tzinfo=UTC),
        inside_geofence=None,
        distance_m=None,
        is_mock_location=False,
        drift_seconds=None,
        drift_flagged=False,
    )
    resp = await client.post(
        "/api/attendance/punches",
        json={"client_id": str(cid), "tech_id": "t5", "kind": "clock_in"},
    )
    assert resp.status_code == 201
    fake_session.commit.assert_awaited()


async def test_tech_cannot_read_another_techs_punches(client: AsyncClient) -> None:
    # The punch log carries GPS + selfie URLs — one tech must not be able to
    # read a colleague's by passing their tech_id.
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    resp = await client.get(
        "/api/attendance/punches?tech_id=t9&start=2026-06-01T00:00:00Z&end=2026-06-08T00:00:00Z"
    )
    assert resp.status_code == 403


async def test_tech_can_read_own_punches(client: AsyncClient, fake_service: AsyncMock) -> None:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    fake_service.list_punches.return_value = []
    resp = await client.get(
        "/api/attendance/punches?tech_id=t5&start=2026-06-01T00:00:00Z&end=2026-06-08T00:00:00Z"
    )
    assert resp.status_code == 200


async def test_tech_cannot_read_another_techs_today(client: AsyncClient) -> None:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    resp = await client.get("/api/attendance/today?tech_id=t9")
    assert resp.status_code == 403


async def test_manager_can_read_any_techs_today(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    # The fixture principal is a manager; reading another tech's state is allowed.
    fake_service.today_status.return_value = TodayStatus(tech_id="t9", clocked_in=False)
    resp = await client.get("/api/attendance/today?tech_id=t9")
    assert resp.status_code == 200


async def test_tech_cannot_complete_another_techs_selfie(client: AsyncClient) -> None:
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    resp = await client.post(
        f"/api/attendance/punches/{uuid4()}/selfie/complete?tech_id=t9",
        json={"size_bytes": 1000},
    )
    assert resp.status_code == 403


async def test_complete_selfie_unknown_returns_404(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.complete_selfie.side_effect = AttendanceNotFoundError("nope")
    resp = await client.post(
        f"/api/attendance/punches/{uuid4()}/selfie/complete?tech_id=t1",
        json={"size_bytes": 1000},
    )
    assert resp.status_code == 404


async def test_complete_selfie_too_large_returns_413(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.complete_selfie.side_effect = SelfieTooLargeError("too big")
    resp = await client.post(
        f"/api/attendance/punches/{uuid4()}/selfie/complete?tech_id=t1",
        json={"size_bytes": 99_999_999},
    )
    assert resp.status_code == 413


async def test_complete_selfie_requires_tech_id(client: AsyncClient) -> None:
    # Missing the required tech_id query param.
    resp = await client.post(
        f"/api/attendance/punches/{uuid4()}/selfie/complete",
        json={"size_bytes": 1000},
    )
    assert resp.status_code == 422


async def test_get_board_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.board.return_value = Board(shop_id="default", date=date(2026, 6, 3), rows=[])
    resp = await client.get("/api/attendance/board?shop_id=default")
    assert resp.status_code == 200
    assert resp.json() == {"shop_id": "default", "date": "2026-06-03", "rows": []}


async def test_payroll_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.payroll.return_value = PayrollExport(
        shop_id="default",
        from_date=date(2026, 6, 1),
        to_date=date(2026, 6, 7),
        rows=[
            PayrollDay(tech_id="t1", date=date(2026, 6, 1), status="present", worked_minutes=480)
        ],
    )
    resp = await client.get("/api/attendance/payroll")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["rows"][0]["tech_id"] == "t1"
    assert body["rows"][0]["worked_minutes"] == 480


async def test_manager_endpoint_requires_auth(client: AsyncClient) -> None:
    # Drop the auth override so the real guard runs: no token → 401.
    app.dependency_overrides.pop(get_current_principal, None)
    resp = await client.get("/api/attendance/board?shop_id=default")
    assert resp.status_code == 401


async def test_manager_endpoint_rejects_technician(client: AsyncClient) -> None:
    # A valid token with role=tech must be forbidden (403) from manager-only
    # endpoints, so a technician cannot read shop-wide payroll / attendance.
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Bilal"
    )
    for path in (
        "/api/attendance/board?shop_id=default",
        "/api/attendance/payroll?start=2026-06-02&end=2026-06-09",
        "/api/attendance/payroll/exports",
        "/api/attendance/grid?month=2026-06",
        "/api/attendance/selfie-gaps",
    ):
        resp = await client.get(path)
        assert resp.status_code == 403, path


async def test_selfie_gaps_returns_200_for_manager(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.selfie_gaps.return_value = []
    resp = await client.get("/api/attendance/selfie-gaps")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_punch_requires_auth(client: AsyncClient) -> None:
    # Tech-facing endpoints are guarded now too (J0.5b): no token → 401.
    app.dependency_overrides.pop(get_current_principal, None)
    resp = await client.post(
        "/api/attendance/punches",
        json={"client_id": str(uuid4()), "tech_id": "t1", "kind": "clock_in"},
    )
    assert resp.status_code == 401


async def test_grid_rejects_bad_month(client: AsyncClient) -> None:
    resp = await client.get("/api/attendance/grid?month=2026-6")
    assert resp.status_code == 422


async def test_post_adjustment_unknown_original_returns_404(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.create_adjustment.side_effect = AttendanceNotFoundError("nope")
    resp = await client.post(
        "/api/attendance/adjustments",
        json={
            "tech_id": "t1",
            "kind": "clock_in",
            "server_time": "2026-06-03T04:00:00Z",
            "reason": "fix",
            "manager_id": "m1",
            "original_event_id": str(uuid4()),
        },
    )
    assert resp.status_code == 404


async def test_get_adjustments_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.list_adjustments.return_value = []
    resp = await client.get("/api/attendance/adjustments?shop_id=default&tech_id=t1")
    assert resp.status_code == 200
    assert resp.json() == []
