"""Router-level tests for the notifications slice (service + session + auth faked)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.features.notifications.router import get_service
from app.features.notifications.service import NotificationService
from app.main import app

_FAKE_PRINCIPAL = Principal(tech_id="t7", role="tech", name="Imran")


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=NotificationService)


@pytest.fixture
def fake_session() -> AsyncMock:
    session = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest_asyncio.fixture
async def client(fake_service: AsyncMock, fake_session: AsyncMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(NotificationService, fake_service)
    app.dependency_overrides[get_session] = lambda: fake_session
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_register_returns_204_and_commits(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    resp = await client.post("/api/devices", json={"token": "ExponentPushToken[abc]"})
    assert resp.status_code == 204, resp.text
    fake_service.register.assert_awaited_once()
    assert fake_service.register.await_args.kwargs["tech_id"] == "t7"
    fake_session.commit.assert_awaited()


async def test_register_rejects_empty_token(client: AsyncClient) -> None:
    resp = await client.post("/api/devices", json={"token": ""})
    assert resp.status_code == 422


async def test_register_requires_auth(client: AsyncClient) -> None:
    app.dependency_overrides.pop(get_current_principal, None)
    resp = await client.post("/api/devices", json={"token": "ExponentPushToken[abc]"})
    assert resp.status_code == 401
