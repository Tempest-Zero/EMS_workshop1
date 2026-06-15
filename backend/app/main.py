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
from zoneinfo import ZoneInfo

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.backup import run_db_backup
from app.core.config import settings
from app.core.db import SessionLocal
from app.core.request_id import RequestIdMiddleware, configure_logging
from app.core.scheduler import add_daily_job, add_weekly_sunday_job, create_scheduler
from app.core.storage import get_storage
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.router import router as attendance_router
from app.features.attendance.schemas import DEFAULT_SHOP_ID
from app.features.attendance.service import AttendanceService
from app.features.health.router import router as health_router
from app.features.identity.router import router as identity_router
from app.features.jobs.router import router as jobs_router
from app.features.media.router import router as media_router
from app.features.notifications.router import router as notifications_router

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


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
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
        scheduler.start()
        logger.info(
            "scheduler started (payroll export: Sundays 18:00 %s; db backup: %s daily %02d:%02d)",
            settings.scheduler_timezone,
            "on" if settings.backup_enabled else "OFF",
            settings.backup_hour,
            settings.backup_minute,
        )
    try:
        yield
    finally:
        if scheduler is not None:
            scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    # Fail-closed before anything else: a production process must not boot with
    # the insecure dev JWT secret (forgeable tokens). No-op in dev.
    settings.assert_safe_for_production()

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
    app.include_router(notifications_router, prefix="/api")

    return app


app = create_app()
