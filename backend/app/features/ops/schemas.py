"""Pydantic response models for the ops slice.

Kept as plain read models — the ops console only ever reads. These map from the
deep-health probes and the ``core.metrics`` dataclasses. (Railway/Sentry shapes
live in the standalone ops server, not here.)
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Status = Literal["ok", "degraded", "down"]


# ── Deep health ──────────────────────────────────────────────────────────────
class ComponentStatus(BaseModel):
    name: str
    status: Status
    latency_ms: float | None = None
    detail: str | None = None


class HealthReport(BaseModel):
    status: Status  # rollup of the components
    generated_at: datetime
    components: list[ComponentStatus]


# ── In-app API metrics (mapped from core.metrics dataclasses) ─────────────────
class RouteMetric(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    route: str
    count: int
    errors_4xx: int
    errors_5xx: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float


class MetricsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uptime_seconds: float
    started_at: float
    total_requests: int
    in_flight: int
    error_rate: float
    routes: list[RouteMetric]
