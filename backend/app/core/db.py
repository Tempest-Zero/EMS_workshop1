"""Async SQLAlchemy engine + session dependency.

Use the FastAPI dep `get_session` inside endpoints/services to get a managed
`AsyncSession`. Each request gets its own session; commit/rollback is the
service's responsibility.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# `pool_pre_ping` avoids stale connections after Supabase / Postgres restarts.
engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: yields a session, ensures it closes."""
    async with SessionLocal() as session:
        yield session
