"""Jobs slice — business logic. Orchestrates the repository; the public surface
for other slices (never reach past this from another feature)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy.exc import IntegrityError

from app.core.config import settings
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
    EvidenceGap,
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
from app.features.media.service import MediaService
from app.shared.geo import haversine_m


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


class JobConflictError(Exception):
    """Raised when an action loses to the job's current state (e.g. claiming a
    job someone else already holds). Routers map it to 409."""


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
        """Create a job with the next human-facing token.

        The token comes from ``max+1``, so two concurrent creates can collide on
        ``uq_job_token`` — recompute and retry instead of surfacing a 500. (A DB
        sequence was rejected: the test schema is also built via
        ``metadata.create_all``, which wouldn't carry a migration-only sequence.)
        """
        last_error: IntegrityError | None = None
        for _ in range(3):
            try:
                created = await self._create_with_next_token(body)
            except IntegrityError as e:
                await self._repo.rollback()
                last_error = e
                continue
            await self._repo.add_event(
                JobEvent(job_id=created.id, kind="create", text="Job created", actor=None)
            )
            return Job.model_validate(created)
        raise last_error if last_error is not None else RuntimeError("unreachable")

    async def _create_with_next_token(self, body: JobCreate) -> JobRow:
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
        return await self._repo.create(row)

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
        self, *, job_id: UUID, shop_id: str, tech_id: str, actor: str | None
    ) -> JobDetail:
        """Manager assignment — deliberately unconditional. Reassigning (or
        overriding a tech's claim) is the manager's prerogative; only the
        technician free-pick (``claim_job``) is guarded."""
        row = await self._load(job_id, shop_id)
        row.assigned_tech_id = tech_id
        row.updated_at = datetime.now(UTC)
        await self._repo.add_event(
            JobEvent(job_id=row.id, kind="assign", text=f"Assigned to {tech_id}", actor=actor)
        )
        return await self._detail(row)

    async def claim_job(self, *, job_id: UUID, shop_id: str, tech_id: str) -> JobDetail:
        """Technician free-pick, guarded: claiming a job someone else already
        holds (or a closed one) is a 409, not a silent steal. Re-claiming your
        OWN job is an idempotent success — offline retries must never error.

        The actual set is an atomic conditional UPDATE (``try_claim``), so two
        techs claiming simultaneously can't both win — the loser's rowcount is
        0 regardless of interleaving.
        """
        row = await self._load(job_id, shop_id)
        if row.status == "closed":
            raise JobConflictError("job is closed")
        already_mine = row.assigned_tech_id == tech_id

        if not await self._repo.try_claim(row.id, tech_id):
            # Lost the race (or it was taken before we looked). Re-read for an
            # accurate holder in the message — `row` predates the UPDATE.
            await self._repo.refresh(row)
            holder = row.assigned_tech_id
            detail = f"already assigned to {holder}" if holder else "job can no longer be claimed"
            raise JobConflictError(detail)

        await self._repo.refresh(row)
        if not already_mine:  # don't append a duplicate event on a re-claim retry
            await self._repo.add_event(
                JobEvent(job_id=row.id, kind="claim", text=f"Claimed by {tech_id}", actor=tech_id)
            )
        return await self._detail(row)

    async def transition(
        self,
        *,
        job_id: UUID,
        shop_id: str,
        body: TransitionRequest,
        actor: str | None,
        media: MediaService | None = None,
    ) -> JobDetail:
        row = await self._load(job_id, shop_id)
        today = datetime.now(UTC).date()

        if body.action == "ready":
            row.status = "ready"
            row.ready_since = today
            kind, text = "ready", "Marked Ready"
        elif body.action == "wait":
            # "Waiting" (on hold — parts on order, customer approval…) finally
            # has a way in. Reason required: an unexplained hold is invisible work.
            if not body.reason:
                raise JobActionError("putting a job on hold requires a reason")
            row.status = "waiting"
            row.waiting_since = today
            row.waiting_reason = body.reason
            kind, text = "status", f"On hold — {body.reason}"
        elif body.action == "close":
            # Closing-video gate (Phase 3): a job can't be closed without at least
            # one `closing` media row. Offline-tolerant — a pending (not-yet-
            # uploaded) row counts, so a tech who captured the clip offline can
            # still close. Media is keyed on the job's token (string).
            if media is not None:
                closing = await media.count_phase(job_id=str(row.token), phase="closing")
                if closing == 0:
                    raise JobActionError("a closing video is required to close")
            # Money guard (Phase 4): a normal close needs the completion form —
            # otherwise a manager close strands the tech's queued completion
            # (409 on replay) and cash gets collected against a job that never
            # billed. Abandon stays the no-completion exit.
            if await self._repo.get_completion(row.id) is None:
                raise JobConflictError("close requires the work-completion form (or abandon)")
            row.status = "closed"
            row.closed_at = datetime.now(UTC)
            kind, text = "status", "Job closed"
        elif body.action == "abandon":
            if not body.reason:
                raise JobActionError("abandon requires a reason")
            row.status = "closed"
            row.closed_at = datetime.now(UTC)
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
        # Money guard (Phase 4): a closed job's bill is a settled document.
        if row.status == "closed":
            raise JobConflictError("job is closed — the completion can no longer be changed")

        completion = await self._repo.get_completion(row.id)
        if completion is None:
            # Snapshot the labour rate at FIRST submission: the bill must never
            # be silently repriced by a later config change. Resubmits reuse it.
            completion = await self._repo.add_completion(
                JobCompletion(job_id=row.id, labour_rate_paisa=settings.labour_rate_paisa)
            )
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

        original = completion_total_paisa(body, completion.labour_rate_paisa)
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
        if row.status == "closed":
            raise JobConflictError("job is closed — the bill can no longer be renegotiated")
        if row.bill_original_paisa is None:
            raise JobActionError("no bill yet — submit the completion form first")
        # Provenance: the event keeps the figure being replaced, so the
        # original-vs-negotiated report has history, not just current values.
        prior = row.bill_negotiated_paisa
        row.bill_negotiated_paisa = amount_paisa
        row.bill_status = "negotiated"
        row.updated_at = datetime.now(UTC)
        suffix = f" ({note})" if note else ""
        if prior is not None:
            text = f"Bill negotiated Rs {prior // 100:,} → Rs {amount_paisa // 100:,}{suffix}"
        else:
            text = f"Bill negotiated → Rs {amount_paisa // 100:,}{suffix}"
        await self._repo.add_event(JobEvent(job_id=row.id, kind="bill", text=text, actor=actor))
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
        queued action (offline retry) does NOT double-charge.

        Two layers of dedup: the fast-path lookup below, and IntegrityError
        recovery for the race the lookup can't see (two concurrent sends pass
        the check, ``uq_job_payment_client`` catches the second at flush — the
        same pattern attendance uses for punches). Without the recovery, the
        loser surfaces a 500 for what is actually a successful no-op.
        """
        row = await self._load(job_id, shop_id)
        existing = await self._repo.get_payment_by_client(client_id)
        if existing is None:
            try:
                await self._repo.add_payment(
                    JobPayment(
                        job_id=row.id,
                        client_id=client_id,
                        amount_paisa=amount_paisa,
                        method=method,
                        recorded_by=actor,
                    )
                )
            except IntegrityError:
                await self._repo.rollback()
                raced = await self._repo.get_payment_by_client(client_id)
                if raced is None:  # some other constraint — not the dedup race
                    raise
                # The rollback expired the earlier load; re-read and return the
                # job as-is. No event append: the winning request wrote it.
                row = await self._load(job_id, shop_id)
                return await self._detail(row)
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

    async def status_by_token(self, *, token: str, shop_id: str) -> str | None:
        """The job's current status, looked up by its human token (media rows
        key on the token). ``None`` for an unknown/non-numeric token — callers
        treat that as "no job to protect"."""
        try:
            numeric = int(token)
        except ValueError:
            return None
        row = await self._repo.get_by_token(token=numeric, shop_id=shop_id)
        return None if row is None else row.status

    # ── Evidence reconciliation (Phase 5) ────────────────────────────────
    async def evidence_gaps(
        self, *, shop_id: str, media: MediaService, today: date, grace_days: int = 2
    ) -> list[EvidenceGap]:
        """Closed jobs whose closing video never actually uploaded. The close
        gate accepts a *pending* media row so an offline tech can close — this
        is the back half of that bargain: after ``grace_days`` the bytes must
        exist, or the job surfaces on the manager dashboard."""
        cutoff = today - timedelta(days=grace_days)
        rows = await self._repo.list_closed_unabandoned(shop_id=shop_id, closed_before=cutoff)
        if not rows:
            return []
        counts = await media.closing_counts(job_ids=[str(r.token) for r in rows])
        gaps: list[EvidenceGap] = []
        for r in rows:
            total, uploaded = counts.get(str(r.token), (0, 0))
            # Only "promised but never arrived": a closing row exists (the gate
            # saw it) but no bytes ever landed. Jobs with no closing rows at all
            # predate the gate — flagging them forever would be noise.
            if total > 0 and uploaded == 0:
                gaps.append(
                    EvidenceGap(
                        id=r.id,
                        token=r.token,
                        customer_name=r.customer_name,
                        closed_at=r.closed_at,
                        closing_uploaded=0,
                    )
                )
        return gaps

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
                labour_rate_paisa=completion.labour_rate_paisa,
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
