"""HTTP endpoints for the jobs slice (mounted under ``/api`` → ``/api/jobs``).

Auth-required from day one: jobs carry customer PII, so every endpoint depends
on ``get_current_principal`` (flat permissions — any logged-in user). Thin by
design: wire deps, call the service, translate domain errors, commit at the
boundary.
"""

from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentPrincipal, require_manager
from app.features.jobs.repository import JobRepository
from app.features.jobs.schemas import (
    DEFAULT_SHOP_ID,
    AssignRequest,
    CompletionRequest,
    EvidenceGap,
    Job,
    JobCreate,
    JobDetail,
    JobStatus,
    LocationRequest,
    NegotiateRequest,
    NoteRequest,
    PaymentRequest,
    PinRequest,
    TransitionRequest,
    TravelLeg,
    TravelSampleBatch,
    TravelSampleBatchResponse,
    TravelTrailOut,
    VoidRequest,
)
from app.features.jobs.service import (
    JobActionError,
    JobConflictError,
    JobForbiddenError,
    JobNotFoundError,
    JobService,
)

# Cross-slice consumption goes through the other slice's deps/service surface —
# never its repository. The close-gate (P3c) checks `closing` media via the
# media service; manager-assign pushes via the notifications service.
from app.features.media.deps import MediaServiceDep
from app.features.notifications.deps import NotificationServiceDep

router = APIRouter(prefix="/jobs", tags=["jobs"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_service(session: SessionDep) -> JobService:
    return JobService(JobRepository(session))


ServiceDep = Annotated[JobService, Depends(get_service)]

ShopId = Annotated[str, Query(max_length=64)]


@router.get("", response_model=list[Job], summary="List jobs (filter by status / tech / search)")
async def list_jobs(
    service: ServiceDep,
    _principal: CurrentPrincipal,
    status: Annotated[JobStatus | None, Query()] = None,
    tech_id: Annotated[str | None, Query(max_length=64)] = None,
    q: Annotated[str | None, Query(max_length=128)] = None,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[Job]:
    return await service.list_jobs(
        shop_id=shop_id, status=status, assigned_tech_id=tech_id, search=q
    )


@router.post(
    "",
    response_model=Job,
    status_code=status.HTTP_201_CREATED,
    summary="Create a job (intake)",
)
async def create_job(
    body: JobCreate,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> Job:
    job = await service.create_job(body, actor=principal.tech_id)
    await session.commit()
    return job


@router.get(
    "/evidence-gaps",
    response_model=list[EvidenceGap],
    summary="Closed jobs whose closing video never uploaded (manager oversight)",
    dependencies=[Depends(require_manager)],
)
async def evidence_gaps(
    service: ServiceDep,
    media: MediaServiceDep,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> list[EvidenceGap]:
    today = datetime.now(UTC).date()
    return await service.evidence_gaps(shop_id=shop_id, media=media, today=today)


@router.get("/{job_id}", response_model=JobDetail, summary="Job detail + timeline")
async def get_job(
    job_id: UUID,
    service: ServiceDep,
    _principal: CurrentPrincipal,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> JobDetail:
    try:
        return await service.get_job(job_id=job_id, shop_id=shop_id)
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e


@router.post(
    "/{job_id}/notes",
    response_model=JobDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Add a note to a job",
)
async def add_note(
    job_id: UUID,
    body: NoteRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    detail = await _note(service, job_id, body.text, principal.tech_id, kind="note")
    await session.commit()
    return detail


@router.post(
    "/{job_id}/followups",
    response_model=JobDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Log a follow-up on a job",
)
async def add_followup(
    job_id: UUID,
    body: NoteRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    detail = await _note(service, job_id, body.text, principal.tech_id, kind="followup")
    await session.commit()
    return detail


@router.post(
    "/{job_id}/transition",
    response_model=JobDetail,
    summary="Change a job's status / schedule (ready, close, abandon, reschedule, haul)",
)
async def transition(
    job_id: UUID,
    body: TransitionRequest,
    service: ServiceDep,
    media: MediaServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.transition(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            body=body,
            actor=principal.tech_id,
            media=media,
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobActionError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except JobConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/assign",
    response_model=JobDetail,
    summary="Assign a job to a specific technician (manager)",
    dependencies=[Depends(require_manager)],
)
async def assign(
    job_id: UUID,
    body: AssignRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
    notifications: NotificationServiceDep,
) -> JobDetail:
    detail = await _assign(service, job_id, body.tech_id, principal.tech_id)
    await session.commit()
    # Best-effort push to the assigned tech — never let it break the assignment.
    with contextlib.suppress(Exception):
        await notifications.notify_assignment(tech_id=body.tech_id, job_token=detail.token)
        # The push may have pruned dead device tokens (FCM UNREGISTERED) —
        # those deletes only flushed; without this second commit they vanish
        # and the registry fans out to ghosts forever.
        await session.commit()
    return detail


@router.post(
    "/{job_id}/claim",
    response_model=JobDetail,
    summary="Claim a job from the work list (technician free-pick) — 409 if already taken",
)
async def claim(
    job_id: UUID,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.claim_job(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, tech_id=principal.tech_id
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/completion",
    response_model=JobDetail,
    summary="Submit the work-completion form (generates the bill)",
)
async def submit_completion(
    job_id: UUID,
    body: CompletionRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.submit_completion(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, body=body, actor=principal.tech_id
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/bill/negotiate",
    response_model=JobDetail,
    summary="Record the negotiated bill amount (keeps the original)",
)
async def negotiate_bill(
    job_id: UUID,
    body: NegotiateRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.negotiate_bill(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            amount_paisa=body.amount_paisa,
            note=body.note,
            actor=principal.tech_id,
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobActionError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except JobConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/payments",
    response_model=JobDetail,
    summary="Log a cash/revenue payment (idempotent on client_id)",
)
async def log_payment(
    job_id: UUID,
    body: PaymentRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.log_payment(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            amount_paisa=body.amount_paisa,
            method=body.method,
            client_id=body.client_id,
            actor=principal.tech_id,
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/payments/{payment_id}/void",
    response_model=JobDetail,
    summary="Void (correct) a payment — append-only, kept for the audit trail",
)
async def void_payment(
    job_id: UUID,
    payment_id: UUID,
    body: VoidRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.void_payment(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            payment_id=payment_id,
            reason=body.reason,
            actor=principal.tech_id,
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/locations",
    response_model=JobDetail,
    summary="Record a GPS punch (depart workshop / arrive customer) — idempotent",
)
async def record_location(
    job_id: UUID,
    body: LocationRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.record_location(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, body=body, actor=principal.tech_id
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/{job_id}/customer-pin",
    response_model=JobDetail,
    summary="Set / move the customer's home pin (assigned tech or manager; audited)",
)
async def set_customer_pin(
    job_id: UUID,
    body: PinRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.set_customer_pin(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            lat=body.lat,
            lng=body.lng,
            actor=principal.tech_id,
            actor_is_manager=principal.role == "manager",
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobActionError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except JobForbiddenError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    await session.commit()
    return detail


@router.get(
    "/{job_id}/travel-samples",
    response_model=TravelTrailOut,
    summary="The recorded breadcrumb trail, decimated for the map (manager oversight)",
    dependencies=[Depends(require_manager)],
)
async def get_travel_trail(
    job_id: UUID,
    service: ServiceDep,
    leg: Annotated[TravelLeg | None, Query()] = None,
    max_points: Annotated[int, Query(ge=10, le=5000)] = 1000,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> TravelTrailOut:
    try:
        return await service.travel_trail(
            job_id=job_id, shop_id=shop_id, leg=leg, max_points=max_points
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e


@router.post(
    "/{job_id}/travel-samples",
    response_model=TravelSampleBatchResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a batch of travel breadcrumbs (≤100; idempotent on client_id)",
)
async def record_travel_samples(
    job_id: UUID,
    body: TravelSampleBatch,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> TravelSampleBatchResponse:
    try:
        result = await service.record_travel_samples(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            body=body,
            actor=principal.tech_id,
            actor_is_manager=principal.role == "manager",
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except JobForbiddenError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    await session.commit()
    return result


async def _assign(service: JobService, job_id: UUID, tech_id: str, actor: str) -> JobDetail:
    try:
        return await service.assign_job(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, tech_id=tech_id, actor=actor
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e


async def _note(
    service: JobService, job_id: UUID, text: str, actor: str, *, kind: str
) -> JobDetail:
    try:
        return await service.add_note(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, text=text, actor=actor, kind=kind
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
