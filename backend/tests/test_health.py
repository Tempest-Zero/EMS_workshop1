"""Smoke test: the API boots and the health endpoint responds."""

from __future__ import annotations

from httpx import ASGITransport, AsyncClient

from app.main import app


async def test_health_endpoint_returns_ok() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["service"] == "fixflow-backend"
