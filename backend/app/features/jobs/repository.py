"""Data access for the `job` table. Thin — the service owns logic. Mutations
``flush`` (so ids/defaults populate) but never ``commit``; the router commits at
the request boundary."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.models import (
    Job,
    JobCompletion,
    JobEvent,
    JobLocation,
    JobMaterial,
    JobPayment,
)


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, job_id: UUID) -> Job | None:
        return await self._session.get(Job, job_id)

    async def rollback(self) -> None:
        """Roll back the in-flight transaction (IntegrityError recovery)."""
        await self._session.rollback()

    async def refresh(self, instance: object) -> None:
        """Re-read an ORM row from the DB (after a raw UPDATE or a rollback)."""
        await self._session.refresh(instance)

    async def try_claim(self, job_id: UUID, tech_id: str) -> bool:
        """Atomically claim a job for ``tech_id`` — only if it is unassigned
        (or already theirs) and not closed. The conditional UPDATE takes the
        row lock, so two concurrent claims can't both win; the loser sees
        rowcount 0. This is the guard the check-then-set path can't provide.
        """
        stmt = (
            update(Job)
            .where(
                Job.id == job_id,
                Job.status != "closed",
                or_(Job.assigned_tech_id.is_(None), Job.assigned_tech_id == tech_id),
            )
            .values(assigned_tech_id=tech_id, updated_at=datetime.now(UTC))
        )
        result = await self._session.execute(stmt)
        # execute() is typed as the base Result; an UPDATE actually yields a
        # CursorResult, which is what carries rowcount.
        return bool(cast(CursorResult[Any], result).rowcount)

    async def next_token(self) -> int:
        """The next human-facing job number. Starts at 1052 (the prototype's
        ``NEXT_TOKEN``) on an empty table; the unique constraint guards races."""
        result = await self._session.execute(select(func.max(Job.token)))
        current = result.scalar_one_or_none()
        return (current or 1051) + 1

    async def list_jobs(
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

    # ── Timeline ─────────────────────────────────────────────────────────
    async def get_by_token(self, *, token: int, shop_id: str) -> Job | None:
        result = await self._session.execute(
            select(Job).where(Job.token == token, Job.shop_id == shop_id)
        )
        return result.scalar_one_or_none()

    async def list_closed_unabandoned(self, *, shop_id: str, closed_before: date) -> list[Job]:
        """Closed (not abandoned) jobs whose closure is old enough that their
        closing-video bytes should long since have synced."""
        result = await self._session.execute(
            select(Job)
            .where(
                Job.shop_id == shop_id,
                Job.status == "closed",
                Job.abandoned.is_(False),
                Job.closed_at <= closed_before,
            )
            .order_by(Job.closed_at.desc())
        )
        return list(result.scalars().all())

    async def list_events(self, job_id: UUID) -> list[JobEvent]:
        stmt = select(JobEvent).where(JobEvent.job_id == job_id).order_by(JobEvent.created_at.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def add_event(self, event: JobEvent) -> JobEvent:
        self._session.add(event)
        await self._session.flush()
        await self._session.refresh(event)
        return event

    # ── Completion + materials ───────────────────────────────────────────
    async def get_completion(self, job_id: UUID) -> JobCompletion | None:
        stmt = select(JobCompletion).where(JobCompletion.job_id == job_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_materials(self, completion_id: UUID) -> list[JobMaterial]:
        stmt = select(JobMaterial).where(JobMaterial.completion_id == completion_id)
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def add_completion(self, completion: JobCompletion) -> JobCompletion:
        self._session.add(completion)
        await self._session.flush()
        await self._session.refresh(completion)
        return completion

    async def clear_materials(self, completion_id: UUID) -> None:
        await self._session.execute(
            delete(JobMaterial).where(JobMaterial.completion_id == completion_id)
        )

    async def add_material(self, material: JobMaterial) -> JobMaterial:
        self._session.add(material)
        await self._session.flush()
        return material

    # ── Payments (cash/revenue ledger) ───────────────────────────────────
    async def list_payments(self, job_id: UUID) -> list[JobPayment]:
        stmt = (
            select(JobPayment)
            .where(JobPayment.job_id == job_id)
            .order_by(JobPayment.recorded_at.asc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_payment(self, payment_id: UUID) -> JobPayment | None:
        return await self._session.get(JobPayment, payment_id)

    async def get_payment_by_client(self, client_id: UUID) -> JobPayment | None:
        stmt = select(JobPayment).where(JobPayment.client_id == client_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def add_payment(self, payment: JobPayment) -> JobPayment:
        self._session.add(payment)
        await self._session.flush()
        await self._session.refresh(payment)
        return payment

    # ── Locations (GPS route) ─────────────────────────────────────────────
    async def list_locations(self, job_id: UUID) -> list[JobLocation]:
        stmt = (
            select(JobLocation)
            .where(JobLocation.job_id == job_id)
            .order_by(JobLocation.captured_at.asc())
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def get_location_by_client(self, client_id: UUID) -> JobLocation | None:
        stmt = select(JobLocation).where(JobLocation.client_id == client_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def add_location(self, location: JobLocation) -> JobLocation:
        self._session.add(location)
        await self._session.flush()
        await self._session.refresh(location)
        return location
