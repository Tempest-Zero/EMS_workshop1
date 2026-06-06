"""Jobs slice — business logic. Orchestrates the repository; the public surface
for other slices (never reach past this from another feature)."""

from __future__ import annotations

from uuid import UUID

from app.features.jobs.models import Job as JobRow
from app.features.jobs.repository import JobRepository
from app.features.jobs.schemas import Job, JobCreate


class JobNotFoundError(LookupError):
    """Raised when a job id doesn't exist (in the caller's shop)."""


class JobService:
    def __init__(self, repo: JobRepository) -> None:
        self._repo = repo

    async def list_jobs(
        self,
        *,
        shop_id: str,
        status: str | None = None,
        assigned_tech_id: str | None = None,
        search: str | None = None,
    ) -> list[Job]:
        rows = await self._repo.list(
            shop_id=shop_id, status=status, assigned_tech_id=assigned_tech_id, search=search
        )
        return [Job.model_validate(r) for r in rows]

    async def get_job(self, *, job_id: UUID, shop_id: str) -> Job:
        row = await self._repo.get(job_id)
        if row is None or row.shop_id != shop_id:
            raise JobNotFoundError(f"job {job_id} not found")
        return Job.model_validate(row)

    async def create_job(self, body: JobCreate) -> Job:
        token = await self._repo.next_token()
        is_visit = body.job_type == "home-visit"
        row = JobRow(
            token=token,
            shop_id=body.shop_id,
            status="open",
            job_type=body.job_type,
            customer_name=body.customer_name.strip(),
            customer_phone=body.customer_phone,
            customer_address=body.customer_address if is_visit else None,
            appliance_type=body.appliance_type,
            appliance_brand=body.appliance_brand,
            appliance_model=body.appliance_model,
            problem=body.problem.strip(),
            assigned_tech_id=body.assigned_tech_id,
            preferred_date=body.preferred_date if is_visit else None,
            time_window=body.time_window if is_visit else None,
        )
        created = await self._repo.create(row)
        return Job.model_validate(created)
