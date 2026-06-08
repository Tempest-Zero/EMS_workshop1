"""Jobs slice — business logic. Orchestrates the repository; the public surface
for other slices (never reach past this from another feature)."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from app.core.config import settings
from app.features.attendance.derive import haversine_m
from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import (
    JobCompletion,
    JobEvent,
    JobLocation,
    JobMaterial,
    JobPayment,
)
from app.features.jobs.repository import JobRepository
from app.features.jobs.schemas import (
    CompletionOut,
    CompletionRequest,
    Job,
    JobCreate,
    JobDetail,
    JobEventOut,
    LocationOut,
    LocationRequest,
    MaterialIn,
    MaterialOut,
    PaymentOut,
    RouteOut,
    TransitionRequest,
)


def _materials_total_paisa(materials: list[MaterialIn]) -> int:
    return sum(m.qty * m.unit_paisa for m in materials)


def _labour_paisa(time_spent_mins: int, rate_paisa: int) -> int:
    """Labour from time on-site, rounded to the nearest paisa — integer only."""
    return (time_spent_mins * rate_paisa + 30) // 60


def completion_total_paisa(body: CompletionRequest, rate_paisa: int) -> int:
    return (
        _materials_total_paisa(body.materials)
        + _labour_paisa(body.time_spent_mins, rate_paisa)
        + body.fuel_paisa
    )


def route_fuel_paisa(distance_m: float, rate_paisa_per_km: int) -> int:
    """Fuel/running-cost estimate from a route distance. Integer paisa only."""
    return round(distance_m / 1000 * rate_paisa_per_km)


def _latest_location(locations: list[JobLocation], kind: str) -> JobLocation | None:
    matching = [loc for loc in locations if loc.kind == kind]
    return max(matching, key=lambda loc: loc.captured_at) if matching else None


def derive_route(locations: list[JobLocation], rate_paisa_per_km: int) -> RouteOut | None:
    """The straight-line route between the latest depart + arrive pins, with a
    fuel estimate. ``None`` until both pins exist."""
    depart = _latest_location(locations, "depart_workshop")
    arrive = _latest_location(locations, "arrive_customer")
    if depart is None or arrive is None:
        return None
    distance_m = haversine_m(depart.lat, depart.lng, arrive.lat, arrive.lng)
    return RouteOut(
        distance_m=distance_m,
        fuel_paisa=route_fuel_paisa(distance_m, rate_paisa_per_km),
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

    # ── Completion + bill (Module 3 post-job / Module 4) ─────────────────
    async def submit_completion(
        self, *, job_id: UUID, shop_id: str, body: CompletionRequest, actor: str | None
    ) -> JobDetail:
        """Upsert the completion form (one per job) and (re)generate the
        original bill. Idempotent — safe to replay from the offline queue."""
        row = await self._load(job_id, shop_id)

        completion = await self._repo.get_completion(row.id)
        if completion is None:
            completion = await self._repo.add_completion(JobCompletion(job_id=row.id))
        else:
            await self._repo.clear_materials(completion.id)

        completion.time_spent_mins = body.time_spent_mins
        completion.fuel_paisa = body.fuel_paisa
        completion.remarks_text = body.remarks_text
        completion.remarks_audio_media_id = body.remarks_audio_media_id
        completion.submitted_by = actor
        completion.submitted_at = datetime.now(UTC)
        for m in body.materials:
            await self._repo.add_material(
                JobMaterial(
                    completion_id=completion.id,
                    name=m.name.strip(),
                    qty=m.qty,
                    unit_paisa=m.unit_paisa,
                )
            )

        original = completion_total_paisa(body, settings.labour_rate_paisa)
        row.bill_original_paisa = original
        row.bill_status = "negotiated" if row.bill_negotiated_paisa is not None else "generated"
        row.updated_at = datetime.now(UTC)
        await self._repo.add_event(
            JobEvent(
                job_id=row.id,
                kind="complete",
                text=f"Work completed — bill Rs {original // 100:,}",
                actor=actor,
            )
        )
        return await self._detail(row)

    async def negotiate_bill(
        self, *, job_id: UUID, shop_id: str, amount_paisa: int, note: str | None, actor: str | None
    ) -> JobDetail:
        row = await self._load(job_id, shop_id)
        if row.bill_original_paisa is None:
            raise JobActionError("no bill yet — submit the completion form first")
        row.bill_negotiated_paisa = amount_paisa
        row.bill_status = "negotiated"
        row.updated_at = datetime.now(UTC)
        suffix = f" ({note})" if note else ""
        await self._repo.add_event(
            JobEvent(
                job_id=row.id,
                kind="bill",
                text=f"Bill negotiated → Rs {amount_paisa // 100:,}{suffix}",
                actor=actor,
            )
        )
        return await self._detail(row)

    # ── Cash / revenue ledger (Module 4) ─────────────────────────────────
    async def log_payment(
        self,
        *,
        job_id: UUID,
        shop_id: str,
        amount_paisa: int,
        method: str,
        client_id: UUID,
        actor: str | None,
    ) -> JobDetail:
        """Append a payment. Idempotent on ``client_id`` — replaying the same
        queued action (offline retry) does NOT double-charge."""
        row = await self._load(job_id, shop_id)
        existing = await self._repo.get_payment_by_client(client_id)
        if existing is None:
            await self._repo.add_payment(
                JobPayment(
                    job_id=row.id,
                    client_id=client_id,
                    amount_paisa=amount_paisa,
                    method=method,
                    recorded_by=actor,
                )
            )
            await self._repo.add_event(
                JobEvent(
                    job_id=row.id,
                    kind="payment",
                    text=f"Payment Rs {amount_paisa // 100:,} ({method})",
                    actor=actor,
                )
            )
            row.updated_at = datetime.now(UTC)
        return await self._detail(row)

    async def void_payment(
        self, *, job_id: UUID, shop_id: str, payment_id: UUID, reason: str, actor: str | None
    ) -> JobDetail:
        """Correct a payment by voiding it (kept for the audit trail)."""
        row = await self._load(job_id, shop_id)
        payment = await self._repo.get_payment(payment_id)
        if payment is None or payment.job_id != row.id:
            raise JobNotFoundError(f"payment {payment_id} not found")
        payment.voided = True
        payment.void_reason = reason
        await self._repo.add_event(
            JobEvent(
                job_id=row.id,
                kind="payment",
                text=f"Payment voided — {reason}",
                actor=actor,
            )
        )
        row.updated_at = datetime.now(UTC)
        return await self._detail(row)

    # ── GPS route (Phase 3) ──────────────────────────────────────────────
    async def record_location(
        self, *, job_id: UUID, shop_id: str, body: LocationRequest, actor: str | None
    ) -> JobDetail:
        """Record a GPS punch. Idempotent on ``client_id`` — replaying a queued
        punch (offline retry) does NOT duplicate it. Once both pins exist the
        detail carries the derived route distance + fuel estimate."""
        row = await self._load(job_id, shop_id)
        existing = await self._repo.get_location_by_client(body.client_id)
        if existing is None:
            await self._repo.add_location(
                JobLocation(
                    job_id=row.id,
                    client_id=body.client_id,
                    kind=body.kind,
                    lat=body.lat,
                    lng=body.lng,
                    accuracy_m=body.accuracy_m,
                    is_mock=body.is_mock,
                    device_time=body.device_time,
                )
            )
            label = "left workshop" if body.kind == "depart_workshop" else "arrived at customer"
            mock = " (mock location)" if body.is_mock else ""
            await self._repo.add_event(
                JobEvent(job_id=row.id, kind="gps", text=f"GPS — {label}{mock}", actor=actor)
            )
            row.updated_at = datetime.now(UTC)
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
        completion = await self._repo.get_completion(row.id)
        if completion is not None:
            materials = await self._repo.list_materials(completion.id)
            detail.completion = CompletionOut(
                time_spent_mins=completion.time_spent_mins,
                fuel_paisa=completion.fuel_paisa,
                remarks_text=completion.remarks_text,
                remarks_audio_media_id=completion.remarks_audio_media_id,
                submitted_at=completion.submitted_at,
                materials=[MaterialOut.model_validate(m) for m in materials],
            )

        payments = await self._repo.list_payments(row.id)
        detail.payments = [PaymentOut.model_validate(p) for p in payments]
        received = sum(p.amount_paisa for p in payments if not p.voided)
        payable = (
            row.bill_negotiated_paisa
            if row.bill_negotiated_paisa is not None
            else (row.bill_original_paisa or 0)
        )
        detail.received_paisa = received
        detail.balance_paisa = payable - received

        locations = await self._repo.list_locations(row.id)
        detail.locations = [LocationOut.model_validate(loc) for loc in locations]
        detail.route = derive_route(locations, settings.fuel_rate_paisa_per_km)
        return detail
