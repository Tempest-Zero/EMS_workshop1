"""Jobs slice — business logic. Orchestrates the repository; the public surface
for other slices (never reach past this from another feature)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobEvent
from app.features.jobs.repository import JobRepository
from app.features.jobs.schemas import (
    Job,
    JobCreate,
    JobDetail,
    JobEventOut,
    TransitionRequest,
)


class JobNotFoundError(LookupError):
    """Raised when a job id doesn't exist (in the caller's shop)."""


class JobActionError(ValueError):
    """Raised when a lifecycle action is missing required input (e.g. an
    abandon with no reason)."""


class JobService:
    def __init__(self, repo: JobRepository) -> None:
        self._repo = repo

    # ── Queries ──────────────────────────────────────────────────────────
    async def list_jobs(
        self,
        *,
        shop_id: str,
        status: str | None = None,
        assigned_tech_id: str | None = None,
        search: str | None = None,
    ) -> list[Job]:
        rows = await self._repo.list_jobs(
            shop_id=shop_id, status=status, assigned_tech_id=assigned_tech_id, search=search
        )
        return [Job.model_validate(r) for r in rows]

    async def get_job(self, *, job_id: UUID, shop_id: str) -> JobDetail:
        row = await self._load(job_id, shop_id)
        return await self._detail(row)

    # ── Commands ─────────────────────────────────────────────────────────
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
        await self._repo.add_event(
            JobEvent(job_id=created.id, kind="create", text="Job created", actor=None)
        )
        return Job.model_validate(created)

    async def add_note(
        self, *, job_id: UUID, shop_id: str, text: str, actor: str | None, kind: str = "note"
    ) -> JobDetail:
        row = await self._load(job_id, shop_id)
        label = "Follow-up" if kind == "followup" else "Note"
        await self._repo.add_event(
            JobEvent(job_id=row.id, kind=kind, text=f"{label}: {text.strip()}", actor=actor)
        )
        row.updated_at = datetime.now(UTC)
        return await self._detail(row)

    async def assign_job(
        self, *, job_id: UUID, shop_id: str, tech_id: str, actor: str | None, claimed: bool = False
    ) -> JobDetail:
        """Assign a job to a technician. ``claimed`` distinguishes a tech
        free-picking it from the work list (claim) from a manager assigning it."""
        row = await self._load(job_id, shop_id)
        row.assigned_tech_id = tech_id
        row.updated_at = datetime.now(UTC)
        kind = "claim" if claimed else "assign"
        verb = "Claimed by" if claimed else "Assigned to"
        await self._repo.add_event(
            JobEvent(job_id=row.id, kind=kind, text=f"{verb} {tech_id}", actor=actor)
        )
        return await self._detail(row)

    async def transition(
        self, *, job_id: UUID, shop_id: str, body: TransitionRequest, actor: str | None
    ) -> JobDetail:
        row = await self._load(job_id, shop_id)
        today = datetime.now(UTC).date()

        if body.action == "ready":
            row.status = "ready"
            row.ready_since = today
            kind, text = "ready", "Marked Ready"
        elif body.action == "close":
            row.status = "closed"
            row.closed_at = today
            kind, text = "status", "Job closed"
        elif body.action == "abandon":
            if not body.reason:
                raise JobActionError("abandon requires a reason")
            row.status = "closed"
            row.closed_at = today
            row.abandoned = True
            row.abandon_reason = body.reason
            kind, text = "status", f"Job abandoned — {body.reason}"
        elif body.action == "reschedule":
            row.preferred_date = body.preferred_date
            row.time_window = body.time_window
            kind, text = "status", "Home visit rescheduled"
        else:  # haul
            row.job_type = "carry-in"
            kind, text = "status", "Converted home visit to carry-in (hauled to shop)"

        row.updated_at = datetime.now(UTC)
        await self._repo.add_event(JobEvent(job_id=row.id, kind=kind, text=text, actor=actor))
        return await self._detail(row)

    # ── Internals ────────────────────────────────────────────────────────
    async def _load(self, job_id: UUID, shop_id: str) -> JobRow:
        row = await self._repo.get(job_id)
        if row is None or row.shop_id != shop_id:
            raise JobNotFoundError(f"job {job_id} not found")
        return row

    async def _detail(self, row: JobRow) -> JobDetail:
        events = await self._repo.list_events(row.id)
        detail = JobDetail.model_validate(row)
        detail.events = [JobEventOut.model_validate(e) for e in events]
        return detail
