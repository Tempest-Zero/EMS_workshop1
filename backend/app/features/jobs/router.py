"""HTTP endpoints for the jobs slice (mounted under ``/api`` → ``/api/jobs``).

Auth-required from day one: jobs carry customer PII, so every endpoint depends
on ``get_current_principal`` (flat permissions — any logged-in user). Thin by
design: wire deps, call the service, translate domain errors, commit at the
boundary.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.storage import StorageClient, get_storage
from app.features.identity.deps import CurrentPrincipal
from app.features.jobs.repository import JobRepository
from app.features.jobs.schemas import (
    DEFAULT_SHOP_ID,
    AssignRequest,
    CompletionRequest,
    Job,
    JobCreate,
    JobDetail,
    JobStatus,
    LocationRequest,
    NegotiateRequest,
    NoteRequest,
    PaymentRequest,
    TransitionRequest,
    VoidRequest,
)
from app.features.jobs.service import JobActionError, JobNotFoundError, JobService
from app.features.media.repository import MediaRepository
from app.features.media.service import MediaService

router = APIRouter(prefix="/jobs", tags=["jobs"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageClient, Depends(get_storage)]


def get_service(session: SessionDep) -> JobService:
    return JobService(JobRepository(session))


# The close-gate (P3c) needs to check for a `closing` media row, so it reaches the
# media slice through its public service (not its table). Scoped to transition.
def get_media_service(session: SessionDep, storage: StorageDep) -> MediaService:
    return MediaService(MediaRepository(session), storage, settings.r2_max_upload_bytes)


ServiceDep = Annotated[JobService, Depends(get_service)]
MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]

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
    _principal: CurrentPrincipal,
) -> Job:
    job = await service.create_job(body)
    await session.commit()
    return job


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
    await session.commit()
    return detail


@router.post(
    "/{job_id}/assign",
    response_model=JobDetail,
    summary="Assign a job to a specific technician (manager)",
)
async def assign(
    job_id: UUID,
    body: AssignRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    detail = await _assign(service, job_id, body.tech_id, principal.tech_id, claimed=False)
    await session.commit()
    return detail


@router.post(
    "/{job_id}/claim",
    response_model=JobDetail,
    summary="Claim a job from the work list (technician free-pick)",
)
async def claim(
    job_id: UUID,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    detail = await _assign(service, job_id, principal.tech_id, principal.tech_id, claimed=True)
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


async def _assign(
    service: JobService, job_id: UUID, tech_id: str, actor: str, *, claimed: bool
) -> JobDetail:
    try:
        return await service.assign_job(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, tech_id=tech_id, actor=actor, claimed=claimed
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
