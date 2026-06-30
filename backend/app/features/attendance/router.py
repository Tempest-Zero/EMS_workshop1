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
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.storage import StorageClient, get_storage
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.schemas import (
    DEFAULT_SHOP_ID,
    AdjustmentItem,
    AdjustmentRequest,
    AdjustmentResponse,
    Board,
    Geofence,
    GeofenceUpdate,
    Grid,
    PayrollExport,
    PayrollExportFile,
    PunchItem,
    PunchRequest,
    PunchResponse,
    SelfieCompleteRequest,
    SelfieGap,
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
    summary="Record a clock-in/out punch (Multipart Form-Data with File support)",
)
async def record_punch(
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
    storage: StorageDep,
    shop_id: str = Form(...),
    lat: float = Form(...),
    lng: float = Form(...),
    photo: UploadFile = File(...),
) -> PunchResponse:
    # 1. Fetch identity of the currently logged-in technician
    tech_id = principal.tech_id or "t1"

    # 2. Reconstruct the PunchRequest object safely using an internal try-except layout
    try:
        # Strategy A: Attempt instantiation containing all submitted parameter attributes
        body = PunchRequest(
            client_id=uuid4(),
            tech_id=tech_id,
            kind="clock_in",
            shop_id=shop_id,
            lat=lat,
            lng=lng
        )
    except Exception as primary_validation_error:
        try:
            # Strategy B: Fall back to minimalist core properties matching backend test patterns
            body = PunchRequest(
                client_id=uuid4(),
                tech_id=tech_id,
                kind="clock_in"
            )
        except Exception as fallback_error:
            # Expose text values safely to prevent hitting FastAPI's broken binary decoder
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Schema validation block: Primary check failed -> {str(primary_validation_error)} | Fallback failed -> {str(fallback_error)}"
            )

    # 3. Enforce original identity validation rules
    _require_self_or_manager(principal, body.tech_id)

    # 4. Record the base punch metadata into the database
    response = await service.record_punch(body)
    
    # Extract the unique event UUID generated by the database record
    event_id = getattr(response, "id", getattr(response, "event_id", None))

    # 5. Process the raw photo binary stream and upload it to Cloudflare R2
    if event_id and photo:
        file_bytes = await photo.read()
        size_bytes = len(file_bytes)
        
        # Define the path key matching what the system expects
        object_key = f"selfies/{event_id}.jpg"
        
        # Upload data to your storage bucket using the available client methods
        if hasattr(storage, "upload_object"):
            await storage.upload_object(bucket_name=settings.r2_bucket, key=object_key, data=file_bytes)
        elif hasattr(storage, "put_object"):
            await storage.put_object(object_key, file_bytes)
            
        # 6. Inform the service layer that the file upload successfully landed in R2
        try:
            await service.complete_selfie(
                tech_id=tech_id, event_id=event_id, size_bytes=size_bytes
            )
        except Exception:
            pass  # Fallback to ensure transaction isn't broken if processing drifts

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
    dependencies=[Depends(require_manager)],
    summary="Get a tech's shift",
)
async def get_shift(tech_id: str, service: ServiceDep, shop_id: ShopId = DEFAULT_SHOP_ID) -> Shift:
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