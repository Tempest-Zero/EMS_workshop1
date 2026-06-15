"""Nightly database backup — pg_dump streamed to R2.

The database holds the things FixFlow exists to protect: the cash ledger,
payroll history, and attendance evidence. The dumps deliberately land on a
DIFFERENT provider from the database (Cloudflare R2 vs Supabase Postgres), so
a single provider incident can never take the data and its backups together.

Dump shape (the choices are load-bearing for restore):
  * ``--format=custom``    — compressed, selectively restorable via pg_restore.
  * ``--schema=public``    — only the app's schema is ours; Supabase-internal
                             schemas (auth, storage, …) are not ours to restore.
  * ``--no-owner``/``--no-privileges`` — restorable into any vanilla Postgres
                             (the restore drill target is a plain container,
                             not a Supabase clone).

Pruning bias matches the outbox: a key that doesn't match our naming is NEVER
deleted — the cost of keeping a stray object is cents; the cost of deleting
the wrong one could be the only copy.

Restore procedure + drill log: ``docs/RUNBOOK-BACKUPS.md``.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import UTC, datetime, timedelta

from app.core.config import settings
from app.core.storage import StorageClient, get_storage

logger = logging.getLogger(__name__)

_KEY_RE = re.compile(r"fixflow-db-(\d{8}T\d{6}Z)\.dump$")
_STAMP_FMT = "%Y%m%dT%H%M%SZ"


def libpq_dsn(sqlalchemy_url: str) -> str:
    """The app's SQLAlchemy URL as a plain libpq URI for pg_dump.

    The config validator guarantees the app URL carries the ``+asyncpg``
    driver marker; pg_dump wants the bare scheme.
    """
    return sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


def backup_key(now: datetime, prefix: str) -> str:
    """Object key for a backup taken at ``now`` (stamped in UTC)."""
    return f"{prefix}fixflow-db-{now.astimezone(UTC).strftime(_STAMP_FMT)}.dump"


def backup_taken_at(key: str) -> datetime | None:
    """When the backup behind ``key`` was taken, or ``None`` if the key isn't
    one of ours (manual uploads, foreign objects — those are never touched)."""
    m = _KEY_RE.search(key)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), _STAMP_FMT).replace(tzinfo=UTC)
    except ValueError:
        return None


def keys_to_prune(keys: list[str], *, now: datetime, retention_days: int) -> list[str]:
    """Our backups older than the retention window. Unrecognized keys are kept."""
    cutoff = now - timedelta(days=retention_days)
    stale: list[str] = []
    for key in keys:
        taken = backup_taken_at(key)
        if taken is not None and taken < cutoff:
            stale.append(key)
    return stale


async def dump_database(dsn: str) -> bytes:
    """Run pg_dump against ``dsn`` and return the dump bytes.

    Runs in the app container (the image installs postgresql-client-17 —
    pg_dump's major version must be >= the server's, and Supabase runs PG 17).
    The whole dump is held in memory: the database is megabytes, and the
    upload seam (`put_bytes`) is the small-artifact path payroll CSVs already
    use. Revisit with streaming multipart only if the DB outgrows that.
    """
    proc = await asyncio.create_subprocess_exec(
        "pg_dump",
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-privileges",
        dsn,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    out, err = await proc.communicate()
    if proc.returncode != 0:
        detail = err.decode(errors="replace").strip()
        raise RuntimeError(f"pg_dump exited {proc.returncode}: {detail}")
    if not out:
        raise RuntimeError("pg_dump produced an empty dump")
    return out


async def run_db_backup(storage: StorageClient | None = None) -> None:
    """The nightly job: dump → upload → prune.

    A duplicate run is harmless (each produces its own timestamped object),
    preserving the scheduler's single-replica contract. Owns no DB session —
    pg_dump opens its own connection.
    """
    store = storage if storage is not None else get_storage()
    data = await dump_database(libpq_dsn(settings.database_url))

    now = datetime.now(UTC)
    key = backup_key(now, settings.backup_prefix)
    store.put_bytes(key, data, "application/octet-stream")
    logger.info("db backup uploaded: %s (%d bytes)", key, len(data))

    stale = keys_to_prune(
        store.list_keys(settings.backup_prefix),
        now=now,
        retention_days=settings.backup_retention_days,
    )
    for old in stale:
        store.delete(old)
    if stale:
        logger.info(
            "pruned %d backup(s) older than %d days", len(stale), settings.backup_retention_days
        )
