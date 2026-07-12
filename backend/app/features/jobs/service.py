"""Jobs slice — business logic. Orchestrates the repository; the public surface
for other slices (never reach past this from another feature)."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime, timedelta
from typing import Literal
from uuid import UUID

from sqlalchemy import and_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.config import settings
from app.features.attendance.service import workshop_circle
from app.features.customers.service import (
    create_customer_with_phone,
    match_customer_by_phone,
    record_consent,
)
from app.features.jobs.catalog_map import category_for_appliance_type
from app.features.jobs.models import (
    DispatchCursor,
    JobCompletion,
    JobLocation,
    JobMaterial,
    JobOutcome,
    JobPayment,
    JobTravelSample,
)
from app.features.jobs.models import Job as JobRow

# Explicit re-export: JobEvent is the payload type of the dispatch contract
# (``DispatchHandler`` below) — outbox consumers type their handlers against
# it through this surface instead of reaching into jobs.models.
from app.features.jobs.models import JobEvent as JobEvent
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
    TravelSampleBatch,
    TravelSampleBatchResponse,
)
from app.features.media.service import MediaService
from app.shared.geo import haversine_m
from app.shared.phone import to_e164_pk

logger = logging.getLogger(__name__)


def _materials_total_paisa(materials: list[MaterialIn]) -> int:
    return sum(m.qty * m.unit_paisa for m in materials)


def _labour_paisa(time_spent_mins: int, rate_paisa: int) -> int:
    """Labour from time on-site, rounded to the nearest paisa — integer only."""
    return (time_spent_mins * rate_paisa + 30) // 60


def completion_total_paisa(body: CompletionRequest, rate_paisa: int, fuel_paisa: int) -> int:
    return (
        _materials_total_paisa(body.materials)
        + _labour_paisa(body.time_spent_mins, rate_paisa)
        + fuel_paisa
    )


def route_fuel_paisa(distance_m: float, rate_paisa_per_km: int) -> int:
    """Fuel/running-cost estimate from a route distance. Integer paisa only."""
    return round(distance_m / 1000 * rate_paisa_per_km)


def _latest_location(locations: list[JobLocation], kind: str) -> JobLocation | None:
    matching = [loc for loc in locations if loc.kind == kind]
    return max(matching, key=lambda loc: loc.captured_at) if matching else None


def _has_route_pins(locations: list[JobLocation]) -> bool:
    """Both boundary pins exist — the precondition for any route derivation
    (and the guard that skips the breadcrumb query for carry-in jobs)."""
    return (
        _latest_location(locations, "depart_workshop") is not None
        and _latest_location(locations, "arrive_customer") is not None
    )


# ── Travel breadcrumbs → billable distance ───────────────────────────────────
# Deliberately module constants, not Settings — promote one only when someone
# actually needs to tune it.
_TRAVEL_MIN_TRUSTED_SAMPLES = 5  # fewer → the path can't be trusted, fall back
_TRAVEL_MAX_SPEED_MPS = 35.0  # ~126 km/h: faster implies a GPS teleport
_TRAVEL_MIN_SEGMENT_M = 10.0  # stationary jitter floor
_TRAVEL_WINDOW_SLACK = timedelta(seconds=120)  # clip tolerance around the punch window


def _trusted_samples(samples: list[JobTravelSample]) -> list[JobTravelSample]:
    """Samples fit to feed money: not a mock fix, and accurate enough to place
    on a road. Stricter than the punches' flag-never-block treatment because a
    path-sum ACCUMULATES noise — and exclusion never blocks anything, the
    ladder just falls back to the circuity estimate."""
    return [
        s
        for s in samples
        if not s.is_mock
        and s.accuracy_m is not None
        and s.accuracy_m <= settings.travel_sample_accuracy_ceiling_m
    ]


def path_sum_m(samples: list[JobTravelSample]) -> float | None:
    """Actual driven distance: the sum of consecutive haversine segments over
    trusted samples (callers pass them ``captured_at``-ascending). ``None``
    when fewer than ``_TRAVEL_MIN_TRUSTED_SAMPLES`` survive filtering — too
    sparse a trail under-counts, and the estimate is more honest.

    Segment rules: time must advance (``dt <= 0`` → duplicate/reordered fix,
    skip); shorter than the jitter floor → parked, skip; implied speed above
    the ceiling → GPS teleport, skip (under-billing a glitch beats over-billing
    it — the straight-line floor in ``derive_route`` catches gross
    under-counts). A long TIME gap at sane speed counts in full: OS-throttled
    sampling over a real stretch of road is legitimate distance."""
    trusted = _trusted_samples(samples)
    if len(trusted) < _TRAVEL_MIN_TRUSTED_SAMPLES:
        return None
    total = 0.0
    for prev, curr in zip(trusted, trusted[1:], strict=False):
        dt = (curr.captured_at - prev.captured_at).total_seconds()
        if dt <= 0:
            continue
        dist = haversine_m(prev.lat, prev.lng, curr.lat, curr.lng)
        if dist < _TRAVEL_MIN_SEGMENT_M or dist / dt > _TRAVEL_MAX_SPEED_MPS:
            continue
        total += dist
    return total


def derive_route(
    locations: list[JobLocation],
    samples: list[JobTravelSample],
    *,
    rate_paisa_per_km: int,
    circuity_factor: float,
    workshop: tuple[float, float, int] | None = None,
) -> RouteOut | None:
    """The billable ONE-WAY route from the workshop to the customer. ``None``
    until an ``arrive_customer`` pin exists — a route means travel provably
    happened.

    Origin: normally the latest ``depart_workshop`` punch. But a forgotten
    "start travel" (no depart punch) or a bogus one co-located with the
    customer (both ends punched on arrival) would otherwise collapse the
    straight-line estimate to ~0 and silently bill no fuel. When the caller
    supplies the ``workshop`` circle ``(center_lat, center_lng, radius_m)`` we
    fall back to the fence centre as the origin: (a) when there is no depart
    punch at all, or (b) when the depart punch sits farther than
    ``max(2×radius_m, 500 m)`` from the fence centre. Without a ``workshop`` the
    behaviour is exactly as before (no depart pin → ``None``).

    Distance ladder: (a) path-sum of trusted outbound breadcrumbs clipped to
    the punch window — actual driven metres; (b) otherwise straight-line ×
    ``circuity_factor``. The window-clip is load-bearing: ``_latest_location``
    means a rescheduled job driven twice must count only the latest drive's
    samples. A "path" shorter than the straight line is physically impossible
    without heavy sample loss, so the estimate wins there too. Breadcrumbs are
    only ever summed when a real depart punch exists (the sampler is armed by
    that punch) — a workshop-origin fallback is always an estimate.

    Leg semantics (wired for the future): outbound = ``leg='outbound'`` within
    depart_workshop→arrive_customer. The return leg (depart_customer→
    arrive_workshop) is collected but not derived yet — billing happens before
    it exists, so the billed round trip is outbound × 2."""
    depart = _latest_location(locations, "depart_workshop")
    arrive = _latest_location(locations, "arrive_customer")
    if arrive is None:
        return None

    # Resolve the route origin (and whether breadcrumbs are eligible).
    origin_lat: float
    origin_lng: float
    trust_breadcrumbs: bool
    if depart is not None:
        origin_lat, origin_lng, trust_breadcrumbs = depart.lat, depart.lng, True
        if workshop is not None:
            center_lat, center_lng, radius_m = workshop
            gap_m = haversine_m(depart.lat, depart.lng, center_lat, center_lng)
            if gap_m > max(2 * radius_m, 500.0):
                # The depart punch isn't at the workshop — trust the fence
                # centre instead. Breadcrumbs still get their shot below; a
                # stationary trail loses to the (now larger) straight line.
                origin_lat, origin_lng = center_lat, center_lng
    elif workshop is not None:
        # No depart punch ⇒ the sampler never armed ⇒ no trail to sum.
        origin_lat, origin_lng, _radius = workshop
        trust_breadcrumbs = False
    else:
        return None  # today's behaviour: no depart pin, no origin → no route

    straight_m = haversine_m(origin_lat, origin_lng, arrive.lat, arrive.lng)

    candidates: list[JobTravelSample] = []
    path: float | None = None
    if trust_breadcrumbs and depart is not None:
        lo = depart.captured_at - _TRAVEL_WINDOW_SLACK
        hi = arrive.captured_at + _TRAVEL_WINDOW_SLACK
        candidates = [s for s in samples if s.leg == "outbound" and lo <= s.captured_at <= hi]
        path = path_sum_m(candidates)

    basis: Literal["estimate", "breadcrumbs"]
    if path is not None and path >= straight_m:
        basis, distance = "breadcrumbs", path
    else:
        basis, distance = "estimate", straight_m * circuity_factor
    return RouteOut(
        distance_m=distance,
        fuel_paisa=route_fuel_paisa(distance, rate_paisa_per_km),
        basis=basis,
        sample_count=len(_trusted_samples(candidates)),
        round_trip_distance_m=distance * 2,
        # Round ONCE on the doubled distance — never double the rounded paisa.
        round_trip_fuel_paisa=route_fuel_paisa(distance * 2, rate_paisa_per_km),
    )


def _gps_trust_window(server_now: datetime) -> tuple[datetime, datetime]:
    """``(oldest, newest)`` acceptable device timestamp for job GPS data."""
    return (
        server_now - timedelta(hours=settings.jobs_gps_backdate_ceiling_hours),
        server_now + timedelta(seconds=settings.jobs_gps_future_tolerance_seconds),
    )


def _effective_capture_time(device_time: datetime | None, server_now: datetime) -> datetime:
    """Punch semantics — re-bucket, never reject (a punch is real evidence even
    with a bad clock): an in-window device clock is "when it happened", so an
    offline-synced depart/arrive pair keeps its real spread instead of landing
    seconds apart at receipt. Outside the window (or absent) fall back to the
    authoritative ``server_now``. Mirrors attendance's ``_effective_time``;
    ``device_time`` stays stored raw for audit either way."""
    if device_time is None:
        return server_now
    dt = device_time if device_time.tzinfo is not None else device_time.replace(tzinfo=UTC)
    lo, hi = _gps_trust_window(server_now)
    return dt if lo <= dt <= hi else server_now


def _sample_in_window(captured_at: datetime, server_now: datetime) -> bool:
    """Ping semantics — the breadcrumb counterpart of ``_effective_capture_time``
    with the attendance pings' deliberate difference: an out-of-window sample is
    REJECTED by the caller, never re-bucketed, because a re-bucketed sample
    would fabricate a path segment "now". Rejection only degrades the fuel line
    to the circuity estimate. Mirrors attendance's ``_ping_in_window``."""
    dt = captured_at if captured_at.tzinfo is not None else captured_at.replace(tzinfo=UTC)
    lo, hi = _gps_trust_window(server_now)
    return lo <= dt <= hi


# Every punch kind gets an honest timeline label (the old binary ternary
# mislabeled the return/delivery legs as "arrived at customer").
_LOCATION_EVENT_LABELS = {
    "depart_workshop": "left workshop",
    "arrive_customer": "arrived at customer",
    "depart_customer": "left customer",
    "arrive_workshop": "back at workshop",
    "depart_workshop_delivery": "left workshop (delivery)",
    "arrive_customer_delivery": "arrived at customer (delivery)",
}


# ── Outbox dispatch (W7/D1) ───────────────────────────────────────────────────
DispatchHandler = Callable[[JobEvent], Awaitable[None]]
DeadLetterHandler = Callable[[JobEvent, Exception], Awaitable[None]]


async def run_dispatch_once(
    session: AsyncSession,
    consumer: str,
    handler: DispatchHandler,
    *,
    limit: int = 100,
    dead_letter: DeadLetterHandler | None = None,
) -> int:
    """Drain up to ``limit`` ``job_event`` rows past ``consumer``'s cursor, in
    ``seq`` order, calling ``handler`` on each. The cursor advances past every
    event the handler accepts. A handler failure is handled per ``dead_letter``:

    * ``None`` (v0 behaviour): halt the batch, leaving the cursor before the
      failed event so it retries next tick.
    * provided (W11): dead-letter the poisoned event — call ``dead_letter`` (to
      record an alarm), advance past it, and keep draining. A permanently-bad
      event can't wedge the whole consumer.

    Commits its own progress (cursor + any dead-letter rows). Returns the number
    of events the cursor moved past."""
    cursor = await session.get(DispatchCursor, consumer)
    if cursor is None:
        cursor = DispatchCursor(consumer=consumer, last_seq=0)
        session.add(cursor)
        await session.flush()

    events = list(
        (
            await session.execute(
                select(JobEvent)
                .where(JobEvent.seq > cursor.last_seq)
                .order_by(JobEvent.seq)
                .limit(limit)
            )
        ).scalars()
    )

    processed = 0
    for event in events:
        try:
            await handler(event)
        except Exception as exc:
            if dead_letter is None:
                logger.exception(
                    "dispatch handler failed: consumer=%s seq=%s — halting batch",
                    consumer,
                    event.seq,
                )
                break
            logger.exception(
                "dispatch handler failed: consumer=%s seq=%s — dead-lettering",
                consumer,
                event.seq,
            )
            await dead_letter(event, exc)
        cursor.last_seq = event.seq
        processed += 1

    if processed:
        cursor.updated_at = datetime.now(UTC)
    await session.commit()
    return processed


# ── Outcome auto-link scan (W8) ───────────────────────────────────────────────
async def run_outcome_auto_link_scan(session: AsyncSession, *, within_days: int = 90) -> int:
    """Record a re-failure outcome for every closed repair that was followed by
    another job on the *same physical unit* within ``within_days``. The later
    job is the strongest signal a repair didn't hold, so we link them as a fact
    rather than inferring it later from customer+category. Idempotent: an
    existing ``auto_link`` row for the same (repair, follow-up) pair is skipped,
    so the daily run is safe to repeat. Returns the number of rows inserted."""
    later = aliased(JobRow)
    already_linked = (
        select(JobOutcome.id)
        .where(
            JobOutcome.job_id == JobRow.id,
            JobOutcome.refail_job_id == later.id,
            JobOutcome.channel == "auto_link",
        )
        .exists()
    )
    stmt = (
        select(
            JobRow.id.label("job_id"),
            later.id.label("refail_job_id"),
            later.created_at.label("checked_at"),
        )
        .join(
            later,
            and_(
                later.appliance_unit_id == JobRow.appliance_unit_id,
                later.id != JobRow.id,
                later.created_at > JobRow.closed_at,
                later.created_at <= JobRow.closed_at + timedelta(days=within_days),
            ),
        )
        .where(
            JobRow.appliance_unit_id.is_not(None),
            JobRow.closed_at.is_not(None),
            ~already_linked,
        )
    )
    pairs = (await session.execute(stmt)).all()

    for pair in pairs:
        session.add(
            JobOutcome(
                job_id=pair.job_id,
                checked_at=pair.checked_at,
                channel="auto_link",
                result="re_failed",
                refail_job_id=pair.refail_job_id,
                recorded_by="system",
            )
        )
    if pairs:
        await session.commit()
    return len(pairs)


# ── Media-orphan sweep (W12; spec §6's one surviving loose ref) ────────────────
MediaOrphanHandler = Callable[[UUID, UUID], Awaitable[None]]


async def run_media_orphan_sweep(
    session: AsyncSession,
    *,
    older_than_hours: int = 48,
    on_orphan: MediaOrphanHandler | None = None,
) -> int:
    """Flag completions whose ``remarks_audio_media_id`` resolves to no
    ``job_media`` row (the audio-note upload failed or was dropped) once they're
    older than ``older_than_hours`` — the reconciliation for the one loose ref
    the model keeps (the completion is the money path; its outbox item must
    never be rejected because the voice note dead-lettered). Logs each and calls
    ``on_orphan`` (the composition root emits the ``media_orphan`` app_event).
    Raw SQL keeps this inside the jobs slice — ``job_media`` is referenced by
    table name, not a cross-slice import."""
    cutoff = datetime.now(UTC) - timedelta(hours=older_than_hours)
    rows = (
        await session.execute(
            text(
                """
                SELECT c.id AS completion_id, c.remarks_audio_media_id AS media_id
                FROM job_completion c
                WHERE c.remarks_audio_media_id IS NOT NULL
                  AND c.submitted_at < :cutoff
                  AND NOT EXISTS (
                      SELECT 1 FROM job_media m WHERE m.id = c.remarks_audio_media_id
                  )
                """
            ).bindparams(cutoff=cutoff)
        )
    ).all()

    for row in rows:
        logger.warning(
            "media orphan: completion=%s remarks_audio_media_id=%s unresolved",
            row.completion_id,
            row.media_id,
        )
        if on_orphan is not None:
            await on_orphan(row.completion_id, row.media_id)
    if rows and on_orphan is not None:
        await session.commit()
    return len(rows)


class JobNotFoundError(LookupError):
    """Raised when a job id doesn't exist (in the caller's shop)."""


class JobActionError(ValueError):
    """Raised when a lifecycle action is missing required input (e.g. an
    abandon with no reason)."""


class JobConflictError(Exception):
    """Raised when an action loses to the job's current state (e.g. claiming a
    job someone else already holds). Routers map it to 409."""


class JobForbiddenError(Exception):
    """Raised when the actor may not act on this job — a tech pushing bulk
    billing evidence (travel breadcrumbs) onto a job that isn't theirs.
    Routers map it to 403."""


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
    async def create_job(self, body: JobCreate, *, actor: str | None = None) -> Job:
        """Create a job with the next human-facing token.

        The token comes from the ``job_token_seq`` sequence, so concurrent
        creates can't collide on ``uq_job_token``. The retry is kept as cheap
        defense-in-depth for the rare ways a number could still pre-exist (a
        hand-inserted row, or a restore that didn't bump the sequence): on the
        unique-violation we just draw the next value and retry, never a 500.
        """
        # Idempotent create (0036): a replayed offline create with the same
        # client_id returns the already-created job instead of a duplicate.
        if body.client_id is not None:
            existing = await self._repo.get_by_client_id(body.client_id)
            if existing is not None:
                return Job.model_validate(existing)
        last_error: IntegrityError | None = None
        for _ in range(3):
            try:
                created = await self._create_with_next_token(body, actor=actor)
            except IntegrityError as e:
                await self._repo.rollback()
                # Two concurrent sends of the same queued create land here via
                # uq_job_client_id — recover the race as the dedupe no-op it
                # is; only the token-collision case should retry.
                if body.client_id is not None:
                    raced = await self._repo.get_by_client_id(body.client_id)
                    if raced is not None:
                        return Job.model_validate(raced)
                last_error = e
                continue
            await self._repo.add_event(
                JobEvent(job_id=created.id, kind="create", text="Job created", actor=None)
            )
            return Job.model_validate(created)
        raise last_error if last_error is not None else RuntimeError("unreachable")

    async def _create_with_next_token(self, body: JobCreate, *, actor: str | None) -> JobRow:
        # Customer link (+ consent, when the F5 chip was ticked) resolves
        # BEFORE the job row is added: a consent failure can then roll back to
        # a clean session and degrade to an unlinked job instead of a 500.
        customer_id = await self._link_customer(body, actor=actor)
        token = await self._repo.next_token()
        # A "visit" is anything the shop travels for. Both home-visit AND
        # pickup-delivery keep the customer's address/pin/schedule; only a
        # carry-in (customer brings the unit in) has no travel and drops them.
        is_visit = body.job_type != "carry-in"
        row = JobRow(
            token=token,
            shop_id=body.shop_id,
            status="open",
            job_type=body.job_type,
            client_id=body.client_id,
            customer_id=customer_id,
            customer_name=body.customer_name.strip(),
            customer_phone=body.customer_phone,
            customer_address=body.customer_address if is_visit else None,
            # The home pin rides the same visit-only rule as the address.
            customer_lat=body.customer_lat if is_visit else None,
            customer_lng=body.customer_lng if is_visit else None,
            appliance_type=body.appliance_type,
            appliance_brand=body.appliance_brand,
            appliance_model=body.appliance_model,
            category_id=body.category_id or category_for_appliance_type(body.appliance_type),
            problem=body.problem.strip(),
            assigned_tech_id=body.assigned_tech_id,
            preferred_date=body.preferred_date if is_visit else None,
            time_window=body.time_window if is_visit else None,
            intake_channel=body.intake_channel,
            type_reason=body.type_reason,
            power_protection=body.power_protection,
            suspected_surge=body.suspected_surge,
            in_warranty_claimed=body.in_warranty_claimed,
        )
        return await self._repo.create(row)

    async def _match_customer(self, body: JobCreate) -> UUID | None:
        """Best-effort link to an existing customer by phone. Intake must never
        fail on this: a match error degrades to an unlinked job (customer_id
        NULL). Returns NULL until backfill populates customers to match against."""
        try:
            return await match_customer_by_phone(
                self._repo.session, body.customer_phone, body.shop_id
            )
        except Exception:
            logger.exception("customer phone match failed at job intake; leaving customer_id NULL")
            return None

    async def _workshop(self, shop_id: str) -> tuple[float, float, int] | None:
        """The workshop geofence circle for route-fuel's origin fallback.
        Failure-tolerant: any error → ``None`` → today's depart-punch-only
        behaviour, never a 500 in a billing path."""
        try:
            return await workshop_circle(self._repo.session, shop_id=shop_id)
        except Exception:
            logger.exception("workshop geofence lookup failed; route fuel falls back to depart pin")
            return None

    async def _link_customer(self, body: JobCreate, *, actor: str | None) -> UUID | None:
        """Resolve the job's customer link, honouring the F5 consent chip.

        Without consent this is the existing best-effort match. With consent
        there must be a customer row to hang the fact on: match one, else
        create one from the intake's name + E.164 mobile (the annex's "no
        match: create customer on submit") — a non-addressable phone means
        there is nothing WhatsApp consent could apply to, so it degrades to
        the plain match. Consent must never fail intake: any error rolls the
        session back (nothing else is pending yet) and links best-effort.
        """
        matched = await self._match_customer(body)
        if not body.whatsapp_consent:
            return matched
        try:
            customer_id = matched
            if customer_id is None:
                phone = to_e164_pk(body.customer_phone)
                if phone is None:
                    logger.info("whatsapp consent without an addressable mobile — not recorded")
                    return None
                created = await create_customer_with_phone(
                    self._repo.session,
                    shop_id=body.shop_id,
                    full_name=body.customer_name.strip(),
                    phone_e164=phone,
                    source=body.intake_channel or "walk_in",
                )
                customer_id = created.id
            await record_consent(
                self._repo.session,
                customer_id=customer_id,
                kind="given",
                scope="whatsapp",
                channel="form",
                recorded_by=actor,
            )
            return customer_id
        except Exception:
            logger.exception("consent recording failed at job intake; linking best-effort")
            await self._repo.rollback()
            return await self._match_customer(body)

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
            # Snapshot BOTH money rates at FIRST submission: the bill must
            # never be silently repriced by a later config change. Resubmits
            # reuse them (auto-derived fuel legitimately recomputes when the
            # route upgrades to breadcrumbs — the pinned rate keeps that
            # recompute honest).
            completion = await self._repo.add_completion(
                JobCompletion(
                    job_id=row.id,
                    labour_rate_paisa=settings.labour_rate_paisa,
                    fuel_rate_paisa_per_km=settings.fuel_rate_paisa_per_km,
                )
            )
        else:
            await self._repo.clear_materials(completion.id)

        # Fuel: an explicit figure (including 0) is the tech's call; omitted →
        # bill the derived ROUND TRIP (outbound × 2 — the return leg hasn't
        # happened yet at billing time). No route (carry-in) → 0. The circuity
        # factor is deliberately NOT snapshotted: it's a distance-model
        # parameter, not a price, and the closed-job guard above already
        # freezes settled bills.
        fuel_basis: str | None
        fuel_distance_m: float | None
        if body.fuel_paisa is not None:
            fuel_paisa, fuel_basis, fuel_distance_m = body.fuel_paisa, "manual", None
        else:
            locations = await self._repo.list_locations(row.id)
            samples = (
                await self._repo.list_travel_samples(row.id) if _has_route_pins(locations) else []
            )
            route = derive_route(
                locations,
                samples,
                rate_paisa_per_km=completion.fuel_rate_paisa_per_km,
                circuity_factor=settings.fuel_route_circuity_factor,
                workshop=await self._workshop(row.shop_id),
            )
            if route is not None and route.round_trip_fuel_paisa is not None:
                fuel_paisa = route.round_trip_fuel_paisa
                fuel_basis = route.basis
                fuel_distance_m = route.round_trip_distance_m
            else:
                fuel_paisa, fuel_basis, fuel_distance_m = 0, None, None

        completion.time_spent_mins = body.time_spent_mins
        completion.fuel_paisa = fuel_paisa
        completion.fuel_basis = fuel_basis
        completion.fuel_distance_m = fuel_distance_m
        completion.remarks_text = body.remarks_text
        completion.remarks_audio_media_id = body.remarks_audio_media_id
        # W5: persist-if-present, flag-never-block. The FK to the seeded
        # vocabulary is the only guard — pickers send seeded slugs or nothing.
        completion.fault_code_id = body.fault_code_id
        completion.action_code_id = body.action_code_id
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

        original = completion_total_paisa(body, completion.labour_rate_paisa, fuel_paisa)
        row.bill_original_paisa = original
        row.bill_status = "negotiated" if row.bill_negotiated_paisa is not None else "generated"
        row.updated_at = datetime.now(UTC)
        await self._repo.add_event(
            JobEvent(
                job_id=row.id,
                kind="complete",
                text=f"Work completed — bill Rs {original // 100:,}",
                actor=actor,
                # Fuel provenance per submission — the completion row is an
                # upsert, so only this payload answers "why was fuel Rs X on
                # the bill we sent" after a resubmit. Numbers/None only (C9).
                payload={
                    "fuel_paisa": fuel_paisa,
                    "fuel_basis": fuel_basis,
                    "fuel_distance_m": fuel_distance_m,
                },
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

    async def log_customer_message(
        self, *, job_id: UUID, shop_id: str, kind: str, channel: str, actor: str | None
    ) -> JobDetail:
        """Record that a customer message went out (the F15 "Send on WhatsApp"
        write, and the Cloud sender's audit trail). A bill send is a ``bill``
        timeline event per the storyboard annex; the other kinds are
        follow-ups. Payload stays PII-free (slugs only, C9)."""
        row = await self._load(job_id, shop_id)
        labels = {
            "intake_ack": "intake acknowledgement",
            "bill": "bill",
            "ready": "ready-for-collection notice",
        }
        via = "click-to-chat" if channel == "clicktochat" else "Cloud API"
        await self._repo.add_event(
            JobEvent(
                job_id=row.id,
                kind="bill" if kind == "bill" else "followup",
                text=f"WhatsApp {labels.get(kind, kind)} sent ({via})",
                actor=actor,
                payload={"whatsapp": kind, "channel": channel},
            )
        )
        row.updated_at = datetime.now(UTC)
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
            now = datetime.now(UTC)
            await self._repo.add_location(
                JobLocation(
                    job_id=row.id,
                    client_id=body.client_id,
                    kind=body.kind,
                    lat=body.lat,
                    lng=body.lng,
                    accuracy_m=body.accuracy_m,
                    is_mock=body.is_mock,
                    # Trust-windowed device clock: an offline-synced depart/
                    # arrive pair keeps its real spread instead of landing
                    # seconds apart at receipt — the breadcrumb window-clip
                    # in derive_route depends on this.
                    captured_at=_effective_capture_time(body.device_time, now),
                    device_time=body.device_time,
                )
            )
            label = _LOCATION_EVENT_LABELS[body.kind]
            mock = " (mock location)" if body.is_mock else ""
            await self._repo.add_event(
                JobEvent(job_id=row.id, kind="gps", text=f"GPS — {label}{mock}", actor=actor)
            )
            row.updated_at = datetime.now(UTC)
        return await self._detail(row)

    async def record_travel_samples(
        self,
        *,
        job_id: UUID,
        shop_id: str,
        body: TravelSampleBatch,
        actor: str,
        actor_is_manager: bool,
    ) -> TravelSampleBatchResponse:
        """Ingest a batch of travel breadcrumbs (bulk droppable telemetry —
        the attendance-ping contract, not the punch rail). Idempotent on
        ``client_id`` so a replayed offline batch dedupes; an out-of-window
        ``captured_at`` is rejected, never re-bucketed. Deliberately no
        ``job_event`` — breadcrumbs are telemetry, not timeline moments.

        Guarded to the assigned tech (or a manager): a batch is bulk BILLING
        evidence, and a stale job id in a phone's queue must not silently
        corrupt another job's fuel line. The guard needs ``assigned_tech_id``,
        a DB read — which is why it lives here, not in the router."""
        row = await self._load(job_id, shop_id)
        if not actor_is_manager and row.assigned_tech_id != actor:
            raise JobForbiddenError(f"job {job_id} is not assigned to {actor}")

        now = datetime.now(UTC)
        fresh = [s for s in body.samples if _sample_in_window(s.captured_at, now)]
        rejected = len(body.samples) - len(fresh)
        if rejected:
            logger.warning(
                "travel samples: rejected %d of %d for job %s (captured_at outside trust window)",
                rejected,
                len(body.samples),
                job_id,
            )
        accepted = await self._repo.create_travel_samples(
            [
                {
                    "job_id": row.id,
                    "client_id": s.client_id,
                    "leg": s.leg,
                    "lat": s.lat,
                    "lng": s.lng,
                    "accuracy_m": s.accuracy_m,
                    "is_mock": s.is_mock,
                    "captured_at": s.captured_at,
                    "recorded_by": actor,
                }
                for s in fresh
            ]
        )
        # The refreshed derivation rides back so the phone sees the estimate →
        # breadcrumbs upgrade without refetching the (heavy) job detail.
        locations = await self._repo.list_locations(row.id)
        samples = await self._repo.list_travel_samples(row.id) if _has_route_pins(locations) else []
        route = derive_route(
            locations,
            samples,
            rate_paisa_per_km=settings.fuel_rate_paisa_per_km,
            circuity_factor=settings.fuel_route_circuity_factor,
            workshop=await self._workshop(row.shop_id),
        )
        return TravelSampleBatchResponse(
            accepted=accepted,
            deduped=len(fresh) - accepted,
            rejected=rejected,
            route=route,
        )

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
                fuel_basis=completion.fuel_basis,
                fuel_distance_m=completion.fuel_distance_m,
                labour_rate_paisa=completion.labour_rate_paisa,
                remarks_text=completion.remarks_text,
                remarks_audio_media_id=completion.remarks_audio_media_id,
                fault_code_id=completion.fault_code_id,
                action_code_id=completion.action_code_id,
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
        # Breadcrumbs are only fetched when a route can exist at all — the
        # common carry-in case skips the query entirely.
        samples = await self._repo.list_travel_samples(row.id) if _has_route_pins(locations) else []
        detail.route = derive_route(
            locations,
            samples,
            rate_paisa_per_km=settings.fuel_rate_paisa_per_km,
            circuity_factor=settings.fuel_route_circuity_factor,
            workshop=await self._workshop(row.shop_id),
        )
        return detail
