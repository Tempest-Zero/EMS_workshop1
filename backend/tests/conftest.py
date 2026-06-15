"""Integration-test harness — a **real Postgres**.

Unit tests across the slices mock the repository/DB, which means the actual SQL
has never executed. These fixtures close that gap: when `FIXFLOW_TEST_DATABASE_URL`
points at a Postgres (CI provides one via a service container; locally you can
point it at the docker-compose DB), `@pytest.mark.integration` tests run the real
queries end-to-end through the ASGI app. When the env var is unset the integration
tests are skipped, so the mock-based unit tests still run with no database.

Isolation: each test gets a session; all tables are truncated at teardown, so the
endpoints' real `commit()` path is exercised and tests stay independent.
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.db import get_session
from app.core.storage import SignedUpload, get_storage
from app.features.identity.models import Technician
from app.features.identity.security import create_access_token, hash_pin
from app.main import app
from app.registry import Base

TEST_DB_URL = os.getenv("FIXFLOW_TEST_DATABASE_URL")

# Hashed once for the whole run (PBKDF2 is deliberately slow); the seeded row
# below needs a syntactically valid hash even though most tests never log in.
_TEST_PIN_HASH = hash_pin("1234")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip integration tests unless a real test database is configured."""
    if TEST_DB_URL is not None:
        return
    skip = pytest.mark.skip(reason="set FIXFLOW_TEST_DATABASE_URL to run integration tests")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(autouse=True)
def _fresh_login_ip_limiter(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset the login per-IP limiter for every test. It is module-level state
    and every ASGI test shares the same client IP — without this, login calls
    accumulated across test files would trip the cap and flake the suite."""
    from app.features.identity import router as identity_router
    from app.features.identity.throttle import IpRateLimiter

    monkeypatch.setattr(identity_router, "_ip_limiter", IpRateLimiter())


class _FakeStorage:
    """In-memory StorageClient so integration tests exercise the DB, not R2."""

    def mint_upload_url(self, path: str, content_type: str | None = None) -> SignedUpload:
        return SignedUpload(signed_url=f"https://fake/upload/{path}", token="", expires_in=600)

    def mint_playback_url(self, path: str, expires_in: int = 3600) -> str:
        return f"https://fake/play/{path}"

    def head_size(self, path: str) -> int | None:
        # No real object in the fake store → fall back to the client-reported
        # size, preserving the integration tests' existing behavior.
        return None

    def delete(self, path: str) -> None:
        return None

    def put_bytes(self, path: str, data: bytes, content_type: str) -> None:
        return None

    def list_keys(self, prefix: str) -> list[str]:
        return []


@pytest_asyncio.fixture
async def _engine() -> AsyncIterator[AsyncEngine]:
    # Function-scoped on purpose: pytest-asyncio gives each test its own event
    # loop, so a session-scoped engine's connections would belong to a different
    # loop (→ "attached to a different loop"). A fresh engine per test avoids that.
    assert TEST_DB_URL is not None  # guarded by the skip hook
    engine = create_async_engine(TEST_DB_URL, pool_pre_ping=True)
    # `checkfirst=True` (default) → a no-op if CI already ran `alembic upgrade head`.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        yield engine
    finally:
        async with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(text(f'TRUNCATE TABLE "{table.name}" CASCADE'))
        await engine.dispose()


@pytest_asyncio.fixture
async def session(_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(bind=_engine, expire_on_commit=False, class_=AsyncSession)
    async with maker() as sess:
        yield sess


@pytest_asyncio.fixture
async def app_client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """ASGI client whose requests hit the real test DB (and a fake R2).

    Seeds the ``t1`` manager row the ``auth_headers`` token names: since 0013
    the auth dependency verifies the caller against the live technician row
    (active + ``token_version``), and the per-test TRUNCATE wipes the rows the
    *migration* seeded — so each test re-seeds its own.
    """
    # merge (not add): in CI the very first test still sees the row the
    # migration seeded (the TRUNCATE only runs at teardown) — upsert semantics
    # cover both that case and the post-truncate/create_all-only case.
    await session.merge(
        Technician(
            id="t1",
            name="Test Manager",
            role="manager",
            pin_hash=_TEST_PIN_HASH,
            active=True,
            failed_attempts=0,
            locked_until=None,
            token_version=0,
        )
    )
    await session.commit()
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_storage] = _FakeStorage
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Bearer header for the auth-guarded manager endpoints (real signed token)."""
    token = create_access_token(tech_id="t1", role="manager", name="Test Manager")
    return {"Authorization": f"Bearer {token}"}
