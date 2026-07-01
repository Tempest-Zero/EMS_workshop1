"""HTTP surface for the ops console — all under ``/api/ops`` and read-only.

Only the two surfaces the backend alone can produce live here: deep health and
in-app API metrics. Every route is gated by ``require_ops_proxy_token`` (a shared
secret in the ``X-Ops-Proxy-Token`` header), so the standalone ops server can
proxy them without a user token. Railway/Sentry are the ops server's own job.
There are no mutations here by design — the console only observes.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.requests import Request

from app.features.ops.deps import OpsServiceDep, require_ops_proxy_token
from app.features.ops.schemas import HealthReport, MetricsResponse

router = APIRouter(prefix="/ops", tags=["ops"], dependencies=[Depends(require_ops_proxy_token)])


@router.get("/health")
async def get_health(request: Request, service: OpsServiceDep) -> HealthReport:
    """Deep readiness: DB, R2, scheduler, migration drift, config presence."""
    scheduler = getattr(request.app.state, "scheduler", None)
    return await service.health_report(scheduler=scheduler)


@router.get("/metrics")
async def get_metrics(service: OpsServiceDep) -> MetricsResponse:
    """In-process API metrics: throughput, error rate, latency percentiles."""
    return service.metrics_snapshot()
