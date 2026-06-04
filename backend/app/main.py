"""FastAPI app factory and router wiring.

Keep this file thin: every feature module exposes an `APIRouter` from its
`router.py`, and `create_app()` mounts each under `/api`. Cross-cutting
concerns (CORS, logging, error handlers) configured here only.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.features.attendance.router import router as attendance_router
from app.features.health.router import router as health_router
from app.features.media.router import router as media_router


def create_app() -> FastAPI:
    app = FastAPI(
        title="FixFlow API",
        version="0.1.0",
        description="Control plane for the FixFlow workshop platform.",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Feature routers — add new slices here as they come online.
    app.include_router(health_router, prefix="/api")
    app.include_router(media_router, prefix="/api")
    app.include_router(attendance_router, prefix="/api")

    return app


app = create_app()
