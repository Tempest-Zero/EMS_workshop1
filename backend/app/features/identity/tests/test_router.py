"""Router tests for the identity slice — service faked, real HTTP wiring.

The one regression that MUST stay covered here: the login router commits the
session **before** raising 401/429. The service bumps the failure counter on a
wrong PIN; without that commit the bump rolls back with the error response and
the throttle silently never engages.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.features.identity import router as identity_router
from app.features.identity.deps import get_current_principal
from app.features.identity.router import get_service
from app.features.identity.schemas import LoginResponse, Principal, TechnicianPublic
from app.features.identity.service import (
    AccountLockedError,
    IdentityService,
    InvalidCredentialsError,
    NotPermittedError,
    PinPolicyError,
    TechnicianNotFoundError,
)
from app.features.identity.throttle import IpRateLimiter
from app.main import app

_MANAGER = Principal(tech_id="t1", role="manager", name="Imran")
_TECH = Principal(tech_id="t5", role="tech", name="Bilal")


def _login_response() -> LoginResponse:
    return LoginResponse(
        token="signed.jwt.here",
        technician=TechnicianPublic(
            id="t1", name="Imran", specialty=None, avatar=None, role="manager", active=True
        ),
    )


@pytest.fixture
def fake_service() -> MagicMock:
    service = MagicMock()
    service.login = AsyncMock(return_value=_login_response())
    service.set_pin = AsyncMock(return_value=None)
    service.revoke_sessions = AsyncMock(return_value=None)
    return service


@pytest.fixture
def fake_session() -> MagicMock:
    session = MagicMock()
    session.commit = AsyncMock()
    return session


@pytest.fixture(autouse=True)
def fresh_ip_limiter(monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test gets its own permissive limiter — the module-level one is
    shared state and other test files (integration) also hit /auth/login."""
    monkeypatch.setattr(identity_router, "_ip_limiter", IpRateLimiter())


@pytest_asyncio.fixture
async def client(fake_service: MagicMock, fake_session: MagicMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(IdentityService, fake_service)
    app.dependency_overrides[get_session] = lambda: fake_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


# ── Login ────────────────────────────────────────────────────────────────────
async def test_login_success_commits_the_counter_reset(
    client: AsyncClient, fake_session: MagicMock
) -> None:
    resp = await client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert resp.status_code == 200
    assert resp.json()["token"] == "signed.jwt.here"
    fake_session.commit.assert_awaited()


async def test_login_failure_commits_the_bumped_counter_before_the_401(
    client: AsyncClient, fake_service: MagicMock, fake_session: MagicMock
) -> None:
    fake_service.login.side_effect = InvalidCredentialsError("nope")
    resp = await client.post("/api/auth/login", json={"tech_id": "t1", "pin": "0000"})
    assert resp.status_code == 401
    # THE regression test: without this commit the throttle never engages.
    fake_session.commit.assert_awaited()


async def test_locked_account_is_429_with_retry_after(
    client: AsyncClient, fake_service: MagicMock
) -> None:
    fake_service.login.side_effect = AccountLockedError(retry_after=120)
    resp = await client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "120"


async def test_ip_cap_is_429_before_the_service_is_even_called(
    client: AsyncClient, fake_service: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(identity_router, "_ip_limiter", IpRateLimiter(max_attempts=1))
    first = await client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert first.status_code == 200
    second = await client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert second.status_code == 429
    assert fake_service.login.await_count == 1


# ── Set PIN ──────────────────────────────────────────────────────────────────
async def test_set_pin_maps_domain_errors(client: AsyncClient, fake_service: MagicMock) -> None:
    app.dependency_overrides[get_current_principal] = lambda: _TECH
    for error, expected in (
        (NotPermittedError("not yours"), 403),
        (TechnicianNotFoundError("ghost"), 404),
        (PinPolicyError("too short"), 422),
    ):
        fake_service.set_pin.side_effect = error
        resp = await client.put("/api/technicians/t2/pin", json={"pin": "4321"})
        assert resp.status_code == expected, expected


async def test_set_pin_success_commits_and_returns_204(
    client: AsyncClient, fake_service: MagicMock, fake_session: MagicMock
) -> None:
    app.dependency_overrides[get_current_principal] = lambda: _MANAGER
    resp = await client.put("/api/technicians/t3/pin", json={"pin": "123456"})
    assert resp.status_code == 204
    fake_service.set_pin.assert_awaited_once_with(
        actor_id="t1", actor_role="manager", tech_id="t3", pin="123456"
    )
    fake_session.commit.assert_awaited()


async def test_set_pin_requires_auth(client: AsyncClient) -> None:
    app.dependency_overrides.pop(get_current_principal, None)
    resp = await client.put("/api/technicians/t2/pin", json={"pin": "4321"})
    assert resp.status_code == 401


# ── Revoke sessions ──────────────────────────────────────────────────────────
async def test_revoke_sessions_is_manager_only(client: AsyncClient) -> None:
    app.dependency_overrides[get_current_principal] = lambda: _TECH
    resp = await client.post("/api/technicians/t2/revoke-sessions")
    assert resp.status_code == 403


async def test_revoke_sessions_commits_and_returns_204(
    client: AsyncClient, fake_service: MagicMock, fake_session: MagicMock
) -> None:
    app.dependency_overrides[get_current_principal] = lambda: _MANAGER
    resp = await client.post("/api/technicians/t9/revoke-sessions")
    assert resp.status_code == 204
    fake_service.revoke_sessions.assert_awaited_once_with(tech_id="t9")
    fake_session.commit.assert_awaited()


async def test_revoke_unknown_tech_is_404(client: AsyncClient, fake_service: MagicMock) -> None:
    app.dependency_overrides[get_current_principal] = lambda: _MANAGER
    fake_service.revoke_sessions.side_effect = TechnicianNotFoundError("ghost")
    resp = await client.post("/api/technicians/ghost/revoke-sessions")
    assert resp.status_code == 404
