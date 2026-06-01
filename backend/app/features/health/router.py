"""Health-check endpoint."""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Liveness probe. Returns ok without touching the database."""
    return {"status": "ok", "service": "fixflow-backend"}
