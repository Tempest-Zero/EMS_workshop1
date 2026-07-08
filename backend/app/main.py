"""FastAPI app factory and router wiring.

Keep this file thin: every feature module exposes an `APIRouter` from its
`router.py`, and `create_app()` mounts each under `/api`. Cross-cutting
concerns (CORS, logging/request ids, error tracking) configured here only.
Scheduled jobs are also registered HERE — main is the composition root, the
one place allowed to wire core machinery to feature services.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from uuid import UUID
from zoneinfo import ZoneInfo

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Register the FULL ORM schema in Base.metadata. Deliberately NOT
# `import app.registry`: that statement also binds the name `app` (the
# package) in this namespace, which `app = create_app()` below would then
# shadow — legal at runtime but a mypy strict error that cascades into every
# test importing `app.main.app`.
from app import registry as _registry  # noqa: F401
from app.core.backup import run_db_backup
from app.core.config import settings
from app.core.db import Base, SessionLocal
from app.core.metrics import MetricsMiddleware
from app.core.request_id import RequestIdMiddleware, configure_logging
from app.core.scheduler import (
    add_daily_job,
    add_interval_job,
    add_weekly_sunday_job,
    create_scheduler,
)
from app.core.storage import get_storage
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.router import router as attendance_router
from app.features.attendance.schemas import DEFAULT_SHOP_ID
from app.features.attendance.service import AttendanceService
from app.features.customer_messaging.deps import get_messaging_service
from app.features.customer_messaging.router import router as messaging_router
from app.features.customer_messaging.router import webhook_router as whatsapp_webhook_router
from app.features.customer_messaging.service import build_dispatch_handler
from app.features.customers.router import router as customers_router
from app.features.customers.service import get_whatsapp_opt_in
from app.features.health.router import router as health_router
from app.features.identity.router import router as identity_router
from app.features.jobs.deps import get_jobs_service
from app.features.jobs.models import JobEvent
from app.features.jobs.router import router as jobs_router
from app.features.jobs.service import (
    run_dispatch_once,
    run_media_orphan_sweep,
    run_outcome_auto_link_scan,
)
from app.features.media.router import router as media_router
from app.features.notifications.router import router as notifications_router
from app.features.ops.router import router as ops_router
from app.features.telemetry.router import router as telemetry_router
from app.features.telemetry.service import (
    MetricRollup,
    record_dead_letter,
    record_media_orphan,
)

logger = logging.getLogger(__name__)


async def _run_payroll_export() -> None:
    """The Sunday job: write last week's attendance CSV to R2 and record it.
    Owns its session (no request to ride): commit on success, rollback on error."""
    today = datetime.now(UTC).astimezone(ZoneInfo(settings.scheduler_timezone)).date()
    async with SessionLocal() as session:
        service = AttendanceService(AttendanceRepository(session), get_storage())
        try:
            await service.run_weekly_export(shop_id=DEFAULT_SHOP_ID, today=today)
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def _run_whatsapp_dispatch() -> None:
    """The interval job: drain new job_event rows into the WhatsApp consumer
    (``customer_messaging``). Owns its session; ``run_dispatch_once`` commits
    its own cursor progress (which also persists the ``customer_message`` rows
    the handler adds). The handler itself degrades to log-only while the Cloud
    API is unconfigured, and records send failures on the row instead of
    raising — so the dead-letter path (advance past + ``outbox_dead_letter``
    app_event) stays reserved for genuinely poisoned events. The composition
    root is the seam that lets jobs, messaging, customers, and telemetry stay
    decoupled from each other."""
    async with SessionLocal() as session:

        async def _dead_letter(event: JobEvent, _exc: Exception) -> None:
            await record_dead_letter(
                session, shop_id=DEFAULT_SHOP_ID, consumer="whatsapp", seq=event.seq
            )

        async def _opt_in(customer_id: UUID) -> datetime | None:
            return await get_whatsapp_opt_in(session, customer_id)

        handler = build_dispatch_handler(
            get_messaging_service(session), get_jobs_service(session), _opt_in
        )
        await run_dispatch_once(session, "whatsapp", handler, dead_letter=_dead_letter)


# Holds the per-route baseline across 5-minute ticks (single-replica).
_metric_rollup = MetricRollup()


async def _run_metric_rollup() -> None:
    """The 5-minute job: snapshot the in-process request metrics and persist the
    delta since the last tick, so ops history survives the next deploy."""
    async with SessionLocal() as session:
        try:
            await _metric_rollup.tick(session)
        except Exception:
            await session.rollback()
            raise


async def _run_outcome_scan() -> None:
    """The daily job: link repeat jobs on the same unit as re-failure outcomes.
    Owns its session; the scan is idempotent so a duplicate run is harmless."""
    async with SessionLocal() as session:
        try:
            n = await run_outcome_auto_link_scan(session)
            logger.info("outcome auto-link scan: %s re-failure row(s) recorded", n)
        except Exception:
            await session.rollback()
            raise


async def _run_media_orphan_sweep() -> None:
    """The daily job: flag completions whose voice note never materialised
    (the one loose ref the model keeps). Emits a ``media_orphan`` app_event per
    orphan; the composition root is the seam so jobs stays decoupled from
    telemetry."""
    async with SessionLocal() as session:

        async def _on_orphan(completion_id: UUID, media_id: UUID) -> None:
            await record_media_orphan(
                session, shop_id=DEFAULT_SHOP_ID, completion_id=completion_id, media_id=media_id
            )

        try:
            n = await run_media_orphan_sweep(session, on_orphan=_on_orphan)
            logger.info("media-orphan sweep: %s orphan(s) flagged", n)
        except Exception:
            await session.rollback()
            raise


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Exposed on app.state so the ops health probe can report the scheduler's
    # running state + next run times (None when disabled or not yet started).
    app.state.scheduler = None
    scheduler = None
    if settings.enable_scheduler:
        scheduler = create_scheduler()
        add_weekly_sunday_job(scheduler, _run_payroll_export, name="payroll-weekly-export")
        if settings.backup_enabled:
            add_daily_job(
                scheduler,
                run_db_backup,
                hour=settings.backup_hour,
                minute=settings.backup_minute,
                name="db-backup-nightly",
            )
        if settings.enable_dispatcher:
            add_interval_job(
                scheduler,
                _run_whatsapp_dispatch,
                seconds=settings.dispatcher_interval_seconds,
                name="outbox-dispatch-whatsapp",
            )
        add_daily_job(
            scheduler,
            _run_outcome_scan,
            hour=3,
            minute=0,
            name="outcome-auto-link-scan",
        )
        add_daily_job(
            scheduler,
            _run_media_orphan_sweep,
            hour=3,
            minute=30,
            name="media-orphan-sweep",
        )
        add_interval_job(
            scheduler,
            _run_metric_rollup,
            seconds=300,
            name="ops-metric-rollup",
        )
        scheduler.start()
        app.state.scheduler = scheduler
        logger.info(
            "scheduler started (payroll: Sundays 18:00 %s; backup: %s daily %02d:%02d; "
            "dispatcher: %s)",
            settings.scheduler_timezone,
            "on" if settings.backup_enabled else "OFF",
            settings.backup_hour,
            settings.backup_minute,
            f"every {settings.dispatcher_interval_seconds}s"
            if settings.enable_dispatcher
            else "OFF",
        )
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        app.state.scheduler = None


def create_app() -> FastAPI:
    # Fail-closed before anything else: a production process must not boot with
    # the insecure dev JWT secret (forgeable tokens). No-op in dev.
    settings.assert_safe_for_production()

    # Fail-fast on a structurally broken ORM graph. Accessing ``sorted_tables``
    # forces the same whole-metadata topological sort a ``session.flush`` does,
    # so a missing model registration (an FK whose target table isn't in the
    # metadata) crashes the boot — which ``start.sh`` treats as fail-safe —
    # instead of 500ing every write at runtime. Guards the ``import app.registry``
    # above against ever being dropped again.
    _ = Base.metadata.sorted_tables

    configure_logging()

    # Error tracking — off unless a DSN is configured (boots fine without an
    # account). PII stays out: no default PII, request bodies never attached
    # (they carry customer names/phones), errors only (no perf tracing).
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.environment,
            send_default_pii=False,
            max_request_body_size="never",
            traces_sample_rate=0,
        )

    app = FastAPI(
        title="FixFlow API",
        version="0.1.0",
        description="Control plane for the FixFlow workshop platform.",
        lifespan=_lifespan,
    )

    app.add_middleware(RequestIdMiddleware)
    # Folds every request into the in-process metrics registry that
    # /api/ops/metrics reads. Inside CORS (so preflights aren't counted),
    # outside the router (so it sees the final status + matched route).
    app.add_middleware(MetricsMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Feature routers — add new slices here as they come online.
    app.include_router(health_router, prefix="/api")
    app.include_router(identity_router, prefix="/api")
    app.include_router(media_router, prefix="/api")
    app.include_router(attendance_router, prefix="/api")
    app.include_router(jobs_router, prefix="/api")
    app.include_router(customers_router, prefix="/api")
    app.include_router(messaging_router, prefix="/api")
    app.include_router(whatsapp_webhook_router, prefix="/api")
    app.include_router(notifications_router, prefix="/api")
    app.include_router(ops_router, prefix="/api")
    app.include_router(telemetry_router, prefix="/api")

    return app


app = create_app()
