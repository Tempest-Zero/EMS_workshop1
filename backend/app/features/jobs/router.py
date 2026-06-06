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
from app.features.jobs.schemas import DEFAULT_SHOP_ID, Job, JobCreate, JobStatus
from app.features.jobs.service import JobNotFoundError, JobService

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


@router.get("/{job_id}", response_model=Job, summary="Job detail")
async def get_job(
    job_id: UUID,
    service: ServiceDep,
    _principal: CurrentPrincipal,
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> Job:
    try:
        return await service.get_job(job_id=job_id, shop_id=shop_id)
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
