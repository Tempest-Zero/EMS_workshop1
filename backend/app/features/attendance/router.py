"""HTTP endpoints for the attendance slice.

Mounted by `app.main` under `/api`, so the full paths are `/api/attendance/...`.
Thin by design: wire deps, call the service, translate domain errors to HTTP,
and commit the session at the request boundary (mirrors the media slice).

Every endpoint requires a logged-in caller (router-level dependency; flat
permissions — any valid token). Callers pass ``tech_id`` / ``shop_id``
explicitly. Recording a punch is identity-checked against the JWT: a technician
can only punch as themselves, while a manager may record on anyone's behalf
(a kiosk / correction). The read + manager endpoints still take ``tech_id``.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
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
    ActiveGeofence,
    AdjustmentItem,
    AdjustmentRequest,
    AdjustmentResponse,
    Board,
    Geofence,
    GeofenceUpdate,
    Grid,
    PayrollExport,
    PayrollExportFile,
    PresenceRequest,
    PresenceResponse,
    PunchItem,
    PunchRequest,
    PunchResponse,
    SelfieCompleteRequest,
    SelfieGap,
    Shift,
    ShiftUpdate,
    TechDays,
    TodayStatus,
    VarianceReport,
)
from app.features.attendance.service import (
    AttendanceNotFoundError,
    AttendanceService,
    SelfieTooLargeError,
)
from app.features.identity.deps import CurrentPrincipal, get_current_principal, require_manager
from app.features.identity.schemas import Principal

router = APIRouter(
    prefix="/attendance",
    tags=["attendance"],
    dependencies=[Depends(get_current_principal)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageClient, Depends(get_storage)]


def get_service(session: SessionDep, storage: StorageDep) -> AttendanceService:
    return AttendanceService(
        AttendanceRepository(session),
        storage,
        selfie_max_bytes=settings.attendance_selfie_max_bytes,
        drift_flag_seconds=settings.attendance_drift_flag_seconds,
        location_accuracy_ceiling_m=settings.attendance_location_accuracy_ceiling_m,
        selfie_grace_hours=settings.attendance_selfie_grace_hours,
        device_time_future_tolerance_seconds=(
            settings.attendance_device_time_future_tolerance_seconds
        ),
        device_time_backdate_ceiling_hours=settings.attendance_device_time_backdate_ceiling_hours,
    )


ServiceDep = Annotated[AttendanceService, Depends(get_service)]

ShopId = Annotated[str, Query(max_length=64)]
TechIds = Annotated[list[str] | None, Query()]


def _require_self_or_manager(principal: Principal, tech_id: str) -> None:
    """A technician may only touch their OWN punches/status; a manager may act
    for any tech. Guards the tech-facing endpoints that take an explicit
    ``tech_id`` (punch evidence carries GPS + selfies — one tech must not be
    able to read or finalize another's)."""
    if principal.role != "manager" and tech_id != principal.tech_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "you can only access your own punches")


# ── Mobile: punches ──────────────────────────────────────────────────────────
@router.post(
    "/punches",
    response_model=PunchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a clock-in/out punch (idempotent on client_id)",
)
async def record_punch(
    body: PunchRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> PunchResponse:
    # A technician can only punch as themselves; a manager may record for any
    # tech. Stops a logged-in tech from clocking in/out as someone else.
    _require_self_or_manager(principal, body.tech_id)
    response = await service.record_punch(body)
    await session.commit()
    return response


@router.post(
    "/presence",
    response_model=PresenceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Log a passive geofence crossing (arrive/depart; idempotent on client_id)",
)
async def record_presence(
    body: PresenceRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> PresenceResponse:
    # A technician's phone logs crossings for itself; a manager may log for any
    # tech. Same self-or-manager guard as a punch — a presence row is evidence
    # tied to a specific tech and must not be writable for someone else.
    _require_self_or_manager(principal, body.tech_id)
    response = await service.record_presence(body)
    await session.commit()
    return response


@router.get(
    "/geofence/active",
    response_model=ActiveGeofence | None,
    summary="The active shop geofence the phone monitors (any authenticated caller)",
)
async def active_geofence(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> ActiveGeofence | None:
    # Deliberately NOT manager-gated (the manager `/geofences` config is): the
    # technician app needs the circle to register OS-level geofencing. Returns
    # only the circle — never the wifi BSSID list.
    return await service.active_geofence(shop_id=shop_id)


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
    principal: CurrentPrincipal,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
) -> PunchItem:
    _require_self_or_manager(principal, tech_id)
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
    principal: CurrentPrincipal,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> TodayStatus:
    _require_self_or_manager(principal, tech_id)
    return await service.today_status(tech_id=tech_id, shop_id=shop_id)


@router.get("/punches", response_model=list[PunchItem], summary="A tech's own punches")
async def list_punches(
    service: ServiceDep,
    principal: CurrentPrincipal,
    tech_id: Annotated[str, Query(min_length=1, max_length=64)],
    start: datetime,
    end: datetime,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[PunchItem]:
    _require_self_or_manager(principal, tech_id)
    return await service.list_punches(tech_id=tech_id, shop_id=shop_id, start=start, end=end)


# ── Manager: board / grid / detail ───────────────────────────────────────────
@router.get(
    "/board",
    response_model=Board,
    dependencies=[Depends(require_manager)],
    summary="Today's board for the shop",
)
async def board(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
    on_date: Annotated[date | None, Query(alias="date")] = None,
    tech_ids: TechIds = None,
) -> Board:
    return await service.board(shop_id=shop_id, day=on_date, tech_ids=tech_ids)


@router.get(
    "/grid",
    response_model=Grid,
    dependencies=[Depends(require_manager)],
    summary="Monthly attendance grid",
)
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
    dependencies=[Depends(require_manager)],
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


@router.get(
    "/payroll",
    response_model=PayrollExport,
    dependencies=[Depends(require_manager)],
    summary="Weekly attendance export for payroll / ERP (defaults to the last 7 days)",
)
async def payroll(
    service: ServiceDep,
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
    shop_id: ShopId = DEFAULT_SHOP_ID,
    tech_ids: TechIds = None,
) -> PayrollExport:
    end_date = end or datetime.now(UTC).date()
    start_date = start or (end_date - timedelta(days=6))
    return await service.payroll(
        shop_id=shop_id, from_date=start_date, to_date=end_date, tech_ids=tech_ids
    )


@router.get(
    "/variance",
    response_model=VarianceReport,
    dependencies=[Depends(require_manager)],
    summary="System-vs-manual attendance variance per tech/day (defaults to the last 7 days)",
)
async def variance(
    service: ServiceDep,
    start: Annotated[date | None, Query()] = None,
    end: Annotated[date | None, Query()] = None,
    shop_id: ShopId = DEFAULT_SHOP_ID,
    tech_ids: TechIds = None,
) -> VarianceReport:
    end_date = end or datetime.now(UTC).date()
    start_date = start or (end_date - timedelta(days=6))
    return await service.variance(
        shop_id=shop_id, from_date=start_date, to_date=end_date, tech_ids=tech_ids
    )


@router.get(
    "/selfie-gaps",
    response_model=list[SelfieGap],
    dependencies=[Depends(require_manager)],
    summary="Punches past the grace window whose selfie never uploaded (manager oversight)",
)
async def selfie_gaps(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[SelfieGap]:
    return await service.selfie_gaps(shop_id=shop_id)


# ── Manager: audited adjustment ──────────────────────────────────────────────
@router.get(
    "/payroll/exports",
    response_model=list[PayrollExportFile],
    summary="Generated weekly payroll CSVs (newest first, signed download URLs)",
    dependencies=[Depends(require_manager)],
)
async def payroll_exports(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[PayrollExportFile]:
    return await service.list_payroll_exports(shop_id=shop_id)


@router.post(
    "/adjustments",
    response_model=AdjustmentResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_manager)],
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


@router.get(
    "/adjustments",
    response_model=list[AdjustmentItem],
    dependencies=[Depends(require_manager)],
    summary="List audited manager corrections",
)
async def list_adjustments(
    service: ServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
    tech_id: Annotated[str | None, Query()] = None,
    start: Annotated[datetime | None, Query()] = None,
    end: Annotated[datetime | None, Query()] = None,
) -> list[AdjustmentItem]:
    return await service.list_adjustments(shop_id=shop_id, tech_id=tech_id, start=start, end=end)


# ── Manager: config ──────────────────────────────────────────────────────────
@router.get(
    "/shifts/{tech_id}",
    response_model=Shift,
    summary="Get a tech's shift (own shift for a tech; any tech for a manager)",
)
async def get_shift(
    tech_id: str,
    service: ServiceDep,
    principal: CurrentPrincipal,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> Shift:
    # A technician must be able to read their OWN shift (the mobile clock screen
    # shows it); a manager may read anyone's. The PUT below stays manager-only.
    _require_self_or_manager(principal, tech_id)
    return await service.get_shift(shop_id=shop_id, tech_id=tech_id)


@router.put(
    "/shifts/{tech_id}",
    response_model=Shift,
    dependencies=[Depends(require_manager)],
    summary="Create/update a tech's shift",
)
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


@router.get(
    "/geofences",
    response_model=Geofence | None,
    dependencies=[Depends(require_manager)],
    summary="Get the shop geofence",
)
async def get_geofence(service: ServiceDep, shop_id: ShopId = DEFAULT_SHOP_ID) -> Geofence | None:
    return await service.get_geofence(shop_id=shop_id)


@router.put(
    "/geofences",
    response_model=Geofence,
    dependencies=[Depends(require_manager)],
    summary="Create/update the shop geofence",
)
async def put_geofence(
    body: GeofenceUpdate,
    service: ServiceDep,
    session: SessionDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> Geofence:
    geofence = await service.upsert_geofence(shop_id=shop_id, body=body)
    await session.commit()
    return geofence
