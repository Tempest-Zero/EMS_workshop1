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
from app.main import app
from app.registry import Base

TEST_DB_URL = os.getenv("FIXFLOW_TEST_DATABASE_URL")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Skip integration tests unless a real test database is configured."""
    if TEST_DB_URL is not None:
        return
    skip = pytest.mark.skip(reason="set FIXFLOW_TEST_DATABASE_URL to run integration tests")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


class _FakeStorage:
    """In-memory StorageClient so integration tests exercise the DB, not R2."""

    def mint_upload_url(self, path: str) -> SignedUpload:
        return SignedUpload(signed_url=f"https://fake/upload/{path}", token="", expires_in=600)

    def mint_playback_url(self, path: str, expires_in: int = 3600) -> str:
        return f"https://fake/play/{path}"

    def delete(self, path: str) -> None:
        return None


@pytest_asyncio.fixture(scope="session")
async def _engine() -> AsyncIterator[AsyncEngine]:
    assert TEST_DB_URL is not None  # guarded by the skip hook
    engine = create_async_engine(TEST_DB_URL, pool_pre_ping=True)
    # `checkfirst=True` (default) → a no-op if CI already ran `alembic upgrade head`.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session(_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    maker = async_sessionmaker(bind=_engine, expire_on_commit=False, class_=AsyncSession)
    sess = maker()
    try:
        yield sess
    finally:
        await sess.close()
        async with _engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                await conn.execute(text(f'TRUNCATE TABLE "{table.name}" CASCADE'))


@pytest_asyncio.fixture
async def app_client(session: AsyncSession) -> AsyncIterator[AsyncClient]:
    """ASGI client whose requests hit the real test DB (and a fake R2)."""
    app.dependency_overrides[get_session] = lambda: session
    app.dependency_overrides[get_storage] = _FakeStorage
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()
