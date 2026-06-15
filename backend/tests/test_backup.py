"""Unit tests for the nightly backup job (core/backup.py).

Pure policy (key naming, retention selection) plus the job's upload/prune
wiring against a fake StorageClient. ``dump_database`` itself is exercised by
the restore drill (docs/RUNBOOK-BACKUPS.md), not unit tests — there is no
meaningful pg_dump to fake.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core import backup
from app.core.backup import (
    backup_key,
    backup_taken_at,
    keys_to_prune,
    libpq_dsn,
    run_db_backup,
)
from app.core.config import settings

NOW = datetime(2026, 6, 11, 21, 30, tzinfo=UTC)


def test_libpq_dsn_strips_async_driver() -> None:
    assert libpq_dsn("postgresql+asyncpg://u:p@host:5432/db") == "postgresql://u:p@host:5432/db"


def test_backup_key_roundtrips_through_taken_at() -> None:
    key = backup_key(NOW, "backups/db/")
    assert key == "backups/db/fixflow-db-20260611T213000Z.dump"
    assert backup_taken_at(key) == NOW


def test_taken_at_rejects_foreign_keys() -> None:
    assert backup_taken_at("backups/db/manual-before-migration.dump") is None
    assert backup_taken_at("media/job123/closing.mp4") is None
    assert backup_taken_at("backups/db/fixflow-db-99999999T999999Z.dump") is None


def test_prune_selects_only_our_stale_keys() -> None:
    fresh = backup_key(NOW - timedelta(days=29), "backups/db/")
    on_boundary = backup_key(NOW - timedelta(days=30), "backups/db/")
    stale = backup_key(NOW - timedelta(days=31), "backups/db/")
    foreign = "backups/db/manual-keep-forever.dump"

    pruned = keys_to_prune([fresh, on_boundary, stale, foreign], now=NOW, retention_days=30)

    assert stale in pruned
    assert fresh not in pruned
    assert foreign not in pruned  # unrecognized keys are never deleted
    assert on_boundary not in pruned  # exactly-at-cutoff is kept (strict <)


class _RecordingStorage:
    """StorageClient fake that records uploads and deletions."""

    def __init__(self, existing: dict[str, bytes] | None = None) -> None:
        self.objects: dict[str, bytes] = dict(existing or {})
        self.deleted: list[str] = []

    def put_bytes(self, path: str, data: bytes, content_type: str) -> None:
        self.objects[path] = data

    def list_keys(self, prefix: str) -> list[str]:
        return [k for k in self.objects if k.startswith(prefix)]

    def delete(self, path: str) -> None:
        self.deleted.append(path)
        self.objects.pop(path, None)

    # Unused StorageClient surface.
    def mint_upload_url(self, path: str, content_type: str | None = None):  # type: ignore[no-untyped-def]
        raise NotImplementedError

    def mint_playback_url(self, path: str, expires_in: int = 3600) -> str:
        raise NotImplementedError

    def head_size(self, path: str) -> int | None:
        return None


async def test_run_db_backup_uploads_then_prunes(monkeypatch: pytest.MonkeyPatch) -> None:
    ancient = backup_key(
        datetime.now(UTC) - timedelta(days=settings.backup_retention_days + 10),
        settings.backup_prefix,
    )
    manual = f"{settings.backup_prefix}manual-keep.dump"
    store = _RecordingStorage({ancient: b"old", manual: b"manual"})

    async def fake_dump(dsn: str) -> bytes:
        assert dsn.startswith("postgresql://")  # driver marker stripped
        return b"PGDMP-fake-bytes"

    monkeypatch.setattr(backup, "dump_database", fake_dump)

    await run_db_backup(storage=store)

    uploaded = [k for k in store.objects if backup_taken_at(k) is not None]
    assert len(uploaded) == 1
    assert store.objects[uploaded[0]] == b"PGDMP-fake-bytes"
    assert store.deleted == [ancient]
    assert manual in store.objects  # foreign keys survive pruning


async def test_run_db_backup_propagates_dump_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    store = _RecordingStorage()

    async def failing_dump(dsn: str) -> bytes:
        raise RuntimeError("pg_dump exited 1: connection refused")

    monkeypatch.setattr(backup, "dump_database", failing_dump)

    with pytest.raises(RuntimeError, match="pg_dump"):
        await run_db_backup(storage=store)
    assert store.objects == {}  # nothing uploaded, nothing pruned on failure
