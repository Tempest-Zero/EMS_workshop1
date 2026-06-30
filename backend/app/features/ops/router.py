"""HTTP surface for the ops console — all under ``/api/ops`` and read-only.

Every route is gated by ``require_ops_access`` at the router level: an
``ops_viewer`` or ``manager`` token passes, everything else gets 403. There are
no mutations here by design — the console only observes.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from starlette.requests import Request

from app.features.identity.deps import require_ops_access
from app.features.ops.deps import OpsServiceDep
from app.features.ops.schemas import HealthReport, MetricsResponse

router = APIRouter(prefix="/ops", tags=["ops"], dependencies=[Depends(require_ops_access)])


@router.get("/health")
async def get_health(request: Request, service: OpsServiceDep) -> HealthReport:
    """Deep readiness: DB, R2, scheduler, migration drift, config presence."""
    scheduler = getattr(request.app.state, "scheduler", None)
    return await service.health_report(scheduler=scheduler)


@router.get("/metrics")
async def get_metrics(service: OpsServiceDep) -> MetricsResponse:
    """In-process API metrics: throughput, error rate, latency percentiles."""
    return service.metrics_snapshot()
