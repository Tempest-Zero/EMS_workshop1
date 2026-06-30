"""Deep health probes for the ops console.

Distinct from the shallow liveness ``GET /api/health`` (which never touches the
DB). This times each dependency and reports a per-component verdict so a teammate
can see *what* is degraded, not just that something is. Read-only and best-effort:
a probe failure becomes a ``degraded``/``down`` row, never a 500.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import DEV_JWT_SECRET, settings
from app.core.storage import StorageClient
from app.features.ops.schemas import ComponentStatus, Status

# A prefix that matches no real object — one bounded LIST round-trip is enough to
# prove R2 auth + reachability without enumerating the backup set.
_R2_PROBE_PREFIX = "_ops_healthcheck/"


def _elapsed_ms(start: float) -> float:
    return round((time.perf_counter() - start) * 1000, 2)


async def check_database(session: AsyncSession) -> ComponentStatus:
    start = time.perf_counter()
    try:
        await session.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any failure here is a DB-down signal
        await session.rollback()
        return ComponentStatus(name="database", status="down", detail=str(exc)[:200])
    return ComponentStatus(name="database", status="ok", latency_ms=_elapsed_ms(start))


async def check_r2(storage: StorageClient) -> ComponentStatus:
    if not settings.r2_access_key_id:
        return ComponentStatus(name="r2_storage", status="degraded", detail="not configured")
    start = time.perf_counter()
    try:
        # boto3 is sync — keep the event loop free.
        await run_in_threadpool(storage.list_keys, _R2_PROBE_PREFIX)
    except Exception as exc:  # noqa: BLE001 — media outage is degraded, app still up
        return ComponentStatus(name="r2_storage", status="degraded", detail=str(exc)[:200])
    return ComponentStatus(name="r2_storage", status="ok", latency_ms=_elapsed_ms(start))


def summarize_scheduler(scheduler: Any, *, enabled: bool) -> ComponentStatus:
    """Report the in-process APScheduler (passed from ``app.state``).

    ``scheduler`` is typed loosely because apscheduler ships no stubs and the
    object is only ever read here.
    """
    if not enabled:
        return ComponentStatus(name="scheduler", status="ok", detail="disabled by config")
    if scheduler is None or not getattr(scheduler, "running", False):
        return ComponentStatus(name="scheduler", status="degraded", detail="enabled but not running")
    jobs = list(scheduler.get_jobs())
    next_runs = [
        f"{job.name}→{job.next_run_time:%Y-%m-%d %H:%M %Z}"
        for job in jobs
        if getattr(job, "next_run_time", None) is not None
    ]
    detail = f"{len(jobs)} job(s): " + ("; ".join(next_runs) if next_runs else "no upcoming runs")
    return ComponentStatus(name="scheduler", status="ok", detail=detail)


def _code_migration_head() -> str | None:
    """The highest migration revision present in the codebase (e.g. ``0018``),
    discovered the same way the CLAUDE.md ground-truth guard does."""
    versions = Path(__file__).resolve().parents[3] / "alembic" / "versions"
    revs = sorted(p.name[:4] for p in versions.glob("*.py") if re.match(r"^\d{4}_", p.name))
    return revs[-1] if revs else None


async def check_migrations(session: AsyncSession) -> ComponentStatus:
    code_head = _code_migration_head()
    try:
        result = await session.execute(text("SELECT version_num FROM alembic_version"))
        row = result.first()
    except Exception as exc:  # noqa: BLE001 — table missing ⇒ migrations never ran
        await session.rollback()
        return ComponentStatus(
            name="migrations", status="degraded", detail=f"alembic_version unreadable: {exc}"[:200]
        )
    db_head = row[0] if row else None
    if db_head is None:
        return ComponentStatus(name="migrations", status="degraded", detail="no migration applied")
    if code_head is not None and db_head != code_head:
        return ComponentStatus(
            name="migrations",
            status="degraded",
            detail=f"drift: db at {db_head}, code head {code_head}",
        )
    return ComponentStatus(name="migrations", status="ok", detail=f"head {db_head}")


def config_presence() -> ComponentStatus:
    """Report WHICH integrations are wired up — booleans only, never the values."""
    flags = {
        "jwt_secret_overridden": settings.jwt_secret != DEV_JWT_SECRET,
        "r2_storage": bool(settings.r2_access_key_id),
        "fcm_push": bool(settings.fcm_service_account_b64),
        "sentry_ingest": bool(settings.sentry_dsn),
        "railway_api": bool(settings.railway_api_token),
        "sentry_issues_api": bool(settings.sentry_auth_token),
    }
    configured = [name for name, present in flags.items() if present]
    missing = [name for name, present in flags.items() if not present]
    detail = f"set: {', '.join(configured) or 'none'} | unset: {', '.join(missing) or 'none'}"
    # In a real deployment the dev JWT secret must be overridden — flag it loudly.
    status: Status = (
        "degraded" if settings.is_production and not flags["jwt_secret_overridden"] else "ok"
    )
    return ComponentStatus(name="config", status=status, detail=detail)


def rollup(components: list[ComponentStatus]) -> Status:
    if any(c.status == "down" for c in components):
        return "down"
    if any(c.status == "degraded" for c in components):
        return "degraded"
    return "ok"
