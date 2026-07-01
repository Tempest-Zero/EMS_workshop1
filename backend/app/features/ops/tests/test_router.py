"""Router-level tests for the ops slice — the shared-token gate + happy-path
shapes.

The service is faked, so no DB/R2 round-trip. The point is the gate: the right
``X-Ops-Proxy-Token`` gets in; a wrong one or a missing header is 401; and when
no token is configured the endpoints are fail-closed.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core import config as config_module
from app.features.ops.deps import get_ops_service
from app.features.ops.schemas import ComponentStatus, HealthReport, MetricsResponse
from app.features.ops.service import OpsService
from app.main import app

_TOKEN = "test-proxy-token-123"

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


@pytest.fixture(autouse=True)
def _set_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_module.settings, "ops_proxy_token", _TOKEN)


@pytest.fixture
def fake_service() -> MagicMock:
    service = MagicMock(spec=OpsService)
    service.health_report = AsyncMock(return_value=_HEALTH)
    service.metrics_snapshot = MagicMock(return_value=_METRICS)
    return service


@asynccontextmanager
async def _client(fake_service: MagicMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_ops_service] = lambda: fake_service
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def ops_client(fake_service: MagicMock) -> AsyncIterator[AsyncClient]:
    async with _client(fake_service) as c:
        yield c


_AUTH = {"X-Ops-Proxy-Token": _TOKEN}


async def test_health_ok_with_token(ops_client: AsyncClient) -> None:
    resp = await ops_client.get("/api/ops/health", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_metrics_ok_with_token(ops_client: AsyncClient) -> None:
    resp = await ops_client.get("/api/ops/metrics", headers=_AUTH)
    assert resp.status_code == 200
    assert resp.json()["total_requests"] == 3


async def test_wrong_token_is_unauthorized(ops_client: AsyncClient) -> None:
    resp = await ops_client.get("/api/ops/health", headers={"X-Ops-Proxy-Token": "nope"})
    assert resp.status_code == 401


async def test_missing_header_is_unauthorized(ops_client: AsyncClient) -> None:
    assert (await ops_client.get("/api/ops/health")).status_code == 401
    assert (await ops_client.get("/api/ops/metrics")).status_code == 401


async def test_unconfigured_token_is_fail_closed(
    fake_service: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A blank token must never mean "open" — even a matching blank header is 401.
    monkeypatch.setattr(config_module.settings, "ops_proxy_token", "")
    async with _client(fake_service) as c:
        assert (await c.get("/api/ops/health", headers={"X-Ops-Proxy-Token": ""})).status_code == 401
        assert (await c.get("/api/ops/health")).status_code == 401
