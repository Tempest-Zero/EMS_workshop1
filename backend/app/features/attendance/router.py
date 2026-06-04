"""HTTP endpoints for the attendance slice.

Mounted by `app.main` under `/api`, so the full paths are `/api/attendance/...`.
Thin by design: wire deps, call the service, translate domain errors to HTTP,
and commit the session at the request boundary (mirrors the media slice).

There is no auth yet — callers pass ``tech_id`` / ``shop_id`` explicitly and the
service enforces ownership. When the auth slice lands these come from the JWT.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.storage import StorageClient, get_storage
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.schemas import (
    DEFAULT_SHOP_ID,
    AdjustmentRequest,
    AdjustmentResponse,
    Board,
    Geofence,
    GeofenceUpdate,
    Grid,
    PunchItem,
    PunchRequest,
    PunchResponse,
    SelfieCompleteRequest,
    Shift,
    ShiftUpdate,
    TechDays,
    TodayStatus,
)
from app.features.attendance.service import (
    AttendanceNotFoundError,
    AttendanceService,
    SelfieTooLargeError,
)

router = APIRouter(prefix="/attendance", tags=["attendance"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageClient, Depends(get_storage)]


def get_service(session: SessionDep, storage: StorageDep) -> AttendanceService:
    return AttendanceService(
        AttendanceRepository(session),
        storage,
        selfie_max_bytes=settings.attendance_selfie_max_bytes,
        drift_flag_seconds=settings.attendance_drift_flag_seconds,
    )


ServiceDep = Annotated[AttendanceService, Depends(get_service)]

ShopId = Annotated[str, Query(max_length=64)]
TechIds = Annotated[list[str] | None, Query()]


# ── Mobile: punches ──────────────────────────────────────────────────────────
@router.post(
    "/punches",
    response_model=PunchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a clock-in/out punch (idempotent on client_id)",
)
async def record_punch(
    body: PunchRequest, service: ServiceDep, session: SessionDep
) -> PunchResponse:
    response = await service.record_punch(body)
    await session.commit()
    return response


@router.post(
    "/punches/{event_id}/selfie/complete",
    response_model=PunchItem,
    summary="Finalize a punch selfie after the phone PUT to R2 succeeded",
)
async def complete_selfie(
    event_id: UUID,
    body: SelfieCompleteRequest,
    service: ServiceDep,
    session: SessionDep,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
) -> PunchItem:
    try:
        item = await service.complete_selfie(
            tech_id=tech_id, event_id=event_id, size_bytes=body.size_bytes
        )
    except AttendanceNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except SelfieTooLargeError as e:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(e)) from e
    await session.commit()
    return item


@router.get("/today", response_model=TodayStatus, summary="A tech's live clock state")
async def today_status(
    service: ServiceDep,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> TodayStatus:
    return await service.today_status(tech_id=tech_id, shop_id=shop_id)


@router.get("/punches", response_model=list[PunchItem], summary="A tech's own punches")
async def list_punches(
    service: ServiceDep,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
    start: datetime,
    end: datetime,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[PunchItem]:
    return await service.list_punches(tech_id=tech_id, shop_id=shop_id, start=start, end=end)


# ── Manager: board / grid / detail ───────────────────────────────────────────
@router.get("/board", response_model=Board, summary="Today's board for the shop")
async def board(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
    on_date: Annotated[date | None, Query(alias="date")] = None,
    tech_ids: TechIds = None,
) -> Board:
    return await service.board(shop_id=shop_id, day=on_date, tech_ids=tech_ids)


@router.get("/grid", response_model=Grid, summary="Monthly attendance grid")
async def grid(
    service: ServiceDep,
    month: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
    shop_id: ShopId = DEFAULT_SHOP_ID,
    tech_ids: TechIds = None,
) -> Grid:
    return await service.grid(shop_id=shop_id, month=month, tech_ids=tech_ids)


@router.get(
    "/techs/{tech_id}/days",
    response_model=TechDays,
    summary="Per-tech daily detail (punches + selfie + location)",
)
async def tech_days(
    tech_id: str,
    service: ServiceDep,
    start: Annotated[date, Query()],
    end: Annotated[date, Query()],
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> TechDays:
    return await service.tech_days(tech_id=tech_id, shop_id=shop_id, from_date=start, to_date=end)


# ── Manager: audited adjustment ──────────────────────────────────────────────
@router.post(
    "/adjustments",
    response_model=AdjustmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Append an audited manager correction",
)
async def create_adjustment(
    body: AdjustmentRequest, service: ServiceDep, session: SessionDep
) -> AdjustmentResponse:
    try:
        response = await service.create_adjustment(body)
    except AttendanceNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return response


# ── Manager: config ──────────────────────────────────────────────────────────
@router.get("/shifts/{tech_id}", response_model=Shift, summary="Get a tech's shift")
async def get_shift(tech_id: str, service: ServiceDep, shop_id: ShopId = DEFAULT_SHOP_ID) -> Shift:
    return await service.get_shift(shop_id=shop_id, tech_id=tech_id)


@router.put("/shifts/{tech_id}", response_model=Shift, summary="Create/update a tech's shift")
async def put_shift(
    tech_id: str,
    body: ShiftUpdate,
    service: ServiceDep,
    session: SessionDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> Shift:
    shift = await service.upsert_shift(shop_id=shop_id, tech_id=tech_id, body=body)
    await session.commit()
    return shift


@router.get("/geofences", response_model=Geofence | None, summary="Get the shop geofence")
async def get_geofence(service: ServiceDep, shop_id: ShopId = DEFAULT_SHOP_ID) -> Geofence | None:
    return await service.get_geofence(shop_id=shop_id)


@router.put("/geofences", response_model=Geofence, summary="Create/update the shop geofence")
async def put_geofence(
    body: GeofenceUpdate,
    service: ServiceDep,
    session: SessionDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> Geofence:
    geofence = await service.upsert_geofence(shop_id=shop_id, body=body)
    await session.commit()
    return geofence
