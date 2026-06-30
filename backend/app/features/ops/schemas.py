"""Pydantic response models for the ops slice.

Kept as plain read models — the ops console only ever reads. Health/metrics map
from internal probes and the ``core.metrics`` dataclasses; Railway/Sentry map
from the proxy clients (see ``railway_client`` / ``sentry_client``).
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


# ── Railway proxy ─────────────────────────────────────────────────────────────
class RailwayService(BaseModel):
    id: str
    name: str
    latest_status: str | None = None  # latest deployment status, if known
    latest_at: datetime | None = None


class DeploymentItem(BaseModel):
    id: str
    status: str  # SUCCESS | FAILED | CRASHED | BUILDING | DEPLOYING | REMOVED | ...
    created_at: datetime | None = None
    commit_sha: str | None = None
    commit_message: str | None = None


class LogLine(BaseModel):
    timestamp: datetime | None = None
    severity: str | None = None  # info | warn | error (best-effort from Railway)
    message: str


class MetricPoint(BaseModel):
    ts: datetime
    value: float


class MetricSeries(BaseModel):
    measurement: str  # CPU_USAGE | MEMORY_USAGE_GB | NETWORK_RX_GB | ...
    points: list[MetricPoint]


# ── Sentry issues feed ────────────────────────────────────────────────────────
class SentryIssue(BaseModel):
    id: str
    title: str
    culprit: str | None = None
    level: str | None = None
    count: int | None = None
    user_count: int | None = None
    last_seen: datetime | None = None
    permalink: str | None = None
    project: str | None = None


# ── Generic "is this integration wired up?" envelope ──────────────────────────
class ProxyStatus(BaseModel):
    """Wraps a proxied payload so the UI can distinguish 'not configured' and
    'upstream unavailable' from real, empty data — without ever leaking why."""

    configured: bool
    available: bool
    detail: str | None = None
