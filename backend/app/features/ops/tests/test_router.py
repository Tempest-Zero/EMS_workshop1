"""Router-level tests for the ops slice — authorization + happy-path shapes.

The service is faked, so no DB/R2/Railway round-trip. The point is the gate:
``ops_viewer`` and ``manager`` get in; ``tech`` is 403; no token is 401.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.features.ops.deps import get_ops_service
from app.features.ops.schemas import ComponentStatus, HealthReport, MetricsResponse
from app.features.ops.service import OpsService
from app.main import app

_HEALTH = HealthReport(
    status="ok",
    generated_at=datetime.now(UTC),
    components=[ComponentStatus(name="database", status="ok", latency_ms=1.2)],
)
_METRICS = MetricsResponse(
    uptime_seconds=12.0,
    started_at=0.0,
    total_requests=3,
    in_flight=0,
    error_rate=0.0,
    routes=[],
)


@pytest.fixture
def fake_service() -> MagicMock:
    service = MagicMock(spec=OpsService)
    service.health_report = AsyncMock(return_value=_HEALTH)
    service.metrics_snapshot = MagicMock(return_value=_METRICS)
    return service


@asynccontextmanager
async def _client(fake_service: MagicMock, principal: Principal | None) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_ops_service] = lambda: fake_service
    if principal is not None:
        app.dependency_overrides[get_current_principal] = lambda: principal
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def ops_client(fake_service: MagicMock) -> AsyncIterator[AsyncClient]:
    principal = Principal(tech_id="ops1", role="ops_viewer", name="Ops Viewer")
    async with _client(fake_service, principal) as c:
        yield c


async def test_health_ok_for_ops_viewer(ops_client: AsyncClient) -> None:
    resp = await ops_client.get("/api/ops/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_metrics_ok_for_ops_viewer(ops_client: AsyncClient) -> None:
    resp = await ops_client.get("/api/ops/metrics")
    assert resp.status_code == 200
    assert resp.json()["total_requests"] == 3


@pytest.mark.parametrize("role", ["manager", "ops_viewer"])
async def test_allowed_roles(fake_service: MagicMock, role: str) -> None:
    principal = Principal(tech_id="x", role=role, name="X")
    async with _client(fake_service, principal) as c:
        assert (await c.get("/api/ops/health")).status_code == 200


async def test_technician_is_forbidden(fake_service: MagicMock) -> None:
    principal = Principal(tech_id="t1", role="tech", name="Tech")
    async with _client(fake_service, principal) as c:
        assert (await c.get("/api/ops/health")).status_code == 403
        assert (await c.get("/api/ops/metrics")).status_code == 403


async def test_missing_token_is_unauthorized(fake_service: MagicMock) -> None:
    # No get_current_principal override → the real bearer check runs and 401s.
    async with _client(fake_service, principal=None) as c:
        assert (await c.get("/api/ops/health")).status_code == 401
