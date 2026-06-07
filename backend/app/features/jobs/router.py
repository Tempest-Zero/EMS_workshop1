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

from app.core.db import get_session
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
    NegotiateRequest,
    NoteRequest,
    TransitionRequest,
)
from app.features.jobs.service import JobActionError, JobNotFoundError, JobService

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
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await service.transition(
            job_id=job_id, shop_id=DEFAULT_SHOP_ID, body=body, actor=principal.tech_id
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
