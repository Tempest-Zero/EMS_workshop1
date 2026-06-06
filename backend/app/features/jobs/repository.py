"""Data access for the `job` table. Thin — the service owns logic. Mutations
``flush`` (so ids/defaults populate) but never ``commit``; the router commits at
the request boundary."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.models import Job


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, job_id: UUID) -> Job | None:
        return await self._session.get(Job, job_id)

    async def next_token(self) -> int:
        """The next human-facing job number. Starts at 1052 (the prototype's
        ``NEXT_TOKEN``) on an empty table; the unique constraint guards races."""
        result = await self._session.execute(select(func.max(Job.token)))
        current = result.scalar_one_or_none()
        return (current or 1051) + 1

    async def list(
        self,
        *,
        shop_id: str,
        status: str | None = None,
        assigned_tech_id: str | None = None,
        search: str | None = None,
    ) -> list[Job]:
        stmt = select(Job).where(Job.shop_id == shop_id)
        if status is not None:
            stmt = stmt.where(Job.status == status)
        if assigned_tech_id is not None:
            stmt = stmt.where(Job.assigned_tech_id == assigned_tech_id)
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    Job.customer_name.ilike(like),
                    Job.appliance_type.ilike(like),
                    Job.appliance_brand.ilike(like),
                    Job.appliance_model.ilike(like),
                    Job.problem.ilike(like),
                )
            )
        # Newest first by token (tokens are monotonic).
        stmt = stmt.order_by(Job.token.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def create(self, job: Job) -> Job:
        self._session.add(job)
        await self._session.flush()
        await self._session.refresh(job)
        return job
