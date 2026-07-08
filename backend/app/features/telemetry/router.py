"""HTTP endpoints for the telemetry slice (mounted under ``/api``).

Ingest only — the rollup runs on the scheduler, not a request. Auth-required:
``actor_kind``/``actor_id`` are derived from the verified JWT, never trusted
from the body.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentPrincipal
from app.features.telemetry.deps import TelemetryServiceDep
from app.features.telemetry.schemas import EventBatch, EventBatchResult
from app.features.telemetry.service import actor_kind_for_role
from app.shared.tenancy import DEFAULT_SHOP_ID

router = APIRouter(prefix="/events", tags=["telemetry"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "",
    summary="Ingest a batch of product-analytics events (≤100; idempotent on client_id)",
)
async def ingest_events(
    batch: EventBatch,
    service: TelemetryServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> EventBatchResult:
    result = await service.ingest(
        batch=batch,
        shop_id=DEFAULT_SHOP_ID,
        actor_kind=actor_kind_for_role(principal.role),
        actor_id=principal.tech_id,
    )
    await session.commit()
    return result
