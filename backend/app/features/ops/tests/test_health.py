"""Unit tests for the deep-health probes. Sessions/storage/scheduler are faked —
no DB or R2 round-trip."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import config as config_module
from app.core.storage import StorageClient
from app.features.ops import health
from app.features.ops.schemas import ComponentStatus, Status


def _component(name: str, status: str, detail: str = "") -> ComponentStatus:
    return ComponentStatus(name=name, status=cast(Status, status), detail=detail)


def test_rollup_precedence() -> None:
    assert health.rollup([_component("a", "ok")]) == "ok"
    assert health.rollup([_component("a", "ok"), _component("b", "degraded")]) == "degraded"
    assert health.rollup([_component("a", "down"), _component("b", "degraded")]) == "down"


async def test_check_database_ok() -> None:
    session = MagicMock()
    session.execute = AsyncMock()
    result = await health.check_database(cast(AsyncSession, session))
    assert result.status == "ok"
    assert result.latency_ms is not None


async def test_check_database_down_rolls_back() -> None:
    session = MagicMock()
    session.execute = AsyncMock(side_effect=RuntimeError("connection refused"))
    session.rollback = AsyncMock()
    result = await health.check_database(cast(AsyncSession, session))
    assert result.status == "down"
    session.rollback.assert_awaited_once()


async def test_check_migrations_matches_code_head() -> None:
    code_head = health._code_migration_head()
    assert code_head is not None  # the repo always has migrations
    session = MagicMock()
    result_row = MagicMock()
    result_row.first.return_value = (code_head,)
    session.execute = AsyncMock(return_value=result_row)
    result = await health.check_migrations(cast(AsyncSession, session))
    assert result.status == "ok"
    assert code_head in (result.detail or "")


async def test_check_migrations_flags_drift() -> None:
    session = MagicMock()
    result_row = MagicMock()
    result_row.first.return_value = ("0001",)  # stale DB head
    session.execute = AsyncMock(return_value=result_row)
    result = await health.check_migrations(cast(AsyncSession, session))
    assert result.status == "degraded"
    assert "drift" in (result.detail or "")


def test_summarize_scheduler_disabled() -> None:
    result = health.summarize_scheduler(None, enabled=False)
    assert result.status == "ok"
    assert "disabled" in (result.detail or "")


def test_summarize_scheduler_enabled_but_missing() -> None:
    result = health.summarize_scheduler(None, enabled=True)
    assert result.status == "degraded"


def test_summarize_scheduler_running() -> None:
    job = SimpleNamespace(name="payroll", next_run_time=None)
    scheduler = SimpleNamespace(running=True, get_jobs=lambda: [job])
    result = health.summarize_scheduler(scheduler, enabled=True)
    assert result.status == "ok"
    assert "1 job" in (result.detail or "")


def test_config_presence_never_leaks_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_module.settings, "ops_proxy_token", "super-secret-token")
    monkeypatch.setattr(config_module.settings, "r2_access_key_id", "")
    result = health.config_presence()
    assert result.name == "config"
    # The secret value must never appear — only presence booleans by name.
    assert "super-secret-token" not in (result.detail or "")
    assert "ops_proxy_token" in (result.detail or "")


async def test_check_r2_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_module.settings, "r2_access_key_id", "")
    storage = MagicMock(spec=StorageClient)
    result = await health.check_r2(cast(StorageClient, storage))
    assert result.status == "degraded"
    assert "not configured" in (result.detail or "")


async def test_check_r2_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(config_module.settings, "r2_access_key_id", "key")
    storage = MagicMock(spec=StorageClient)
    storage.list_keys.return_value = []
    result = await health.check_r2(cast(StorageClient, storage))
    assert result.status == "ok"
