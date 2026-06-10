"""Jobs slice — dependency providers (the cross-slice construction surface).

Another slice that needs the jobs service (e.g. media's delete policy asking
for a job's status) imports ``get_jobs_service`` from here — repositories and
models stay private; ``service.py`` + ``deps.py`` are the contract.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.jobs.repository import JobRepository
from app.features.jobs.service import JobService


def get_jobs_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JobService:
    return JobService(JobRepository(session))


JobsServiceDep = Annotated[JobService, Depends(get_jobs_service)]
