"""Settings validation tests."""

from __future__ import annotations

from app.core.config import Settings


def test_bare_postgresql_scheme_is_coerced_to_asyncpg() -> None:
    s = Settings(database_url="postgresql://user:pw@host:5432/db")
    assert s.database_url == "postgresql+asyncpg://user:pw@host:5432/db"


def test_explicit_asyncpg_scheme_is_left_untouched() -> None:
    url = "postgresql+asyncpg://user:pw@host:5432/db"
    assert Settings(database_url=url).database_url == url
