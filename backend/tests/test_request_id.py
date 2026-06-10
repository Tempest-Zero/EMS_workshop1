"""Request-ID middleware: every response carries X-Request-ID, inbound ids are
honored (proxy correlation), and the logging filter injects the id."""

from __future__ import annotations

import logging

from httpx import ASGITransport, AsyncClient

from app.core.request_id import RequestIdLogFilter, current_request_id
from app.main import app


async def test_responses_carry_a_request_id() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")
    rid = response.headers.get("X-Request-ID")
    assert rid
    assert len(rid) >= 8


async def test_inbound_request_id_is_honored() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health", headers={"X-Request-ID": "proxy-abc-123"})
    assert response.headers["X-Request-ID"] == "proxy-abc-123"


def test_log_filter_injects_the_current_id() -> None:
    record = logging.LogRecord("x", logging.INFO, __file__, 1, "msg", None, None)
    assert RequestIdLogFilter().filter(record) is True
    # Outside a request the contextvar default applies.
    assert record.request_id == current_request_id() == "-"  # type: ignore[attr-defined]
