"""FastAPI app factory and router wiring.

Keep this file thin: every feature module exposes an `APIRouter` from its
`router.py`, and `create_app()` mounts each under `/api`. Cross-cutting
concerns (CORS, logging/request ids, error tracking) configured here only.
"""

from __future__ import annotations

import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.request_id import RequestIdMiddleware, configure_logging
from app.features.attendance.router import router as attendance_router
from app.features.health.router import router as health_router
from app.features.identity.router import router as identity_router
from app.features.jobs.router import router as jobs_router
from app.features.media.router import router as media_router
from app.features.notifications.router import router as notifications_router


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
