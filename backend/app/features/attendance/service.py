"""Attendance slice — business logic and the public surface for other slices.

Orchestrates the repository (DB) and the storage client (R2, reused from the
media slice for selfies). Ownership is enforced here (callers pass ``tech_id``;
when the auth slice lands this becomes JWT-derived authz). All timezone math
lives here so `derive.py` stays pure.
"""

from __future__ import annotations

import calendar
import csv as csv_module
import io as io_module
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import PurePosixPath
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from app.core.storage import DEFAULT_UPLOAD_TTL, StorageClient
from app.features.attendance.derive import (
    DEFAULT_SHIFT,
    DEFAULT_TIMEZONE,
    LocalPunch,
    ShiftSpec,
    classify_day,
    geofence_flags,
)
from app.features.attendance.models import (
    AttendanceEvent,
    AttendanceGeofence,
    AttendancePresenceEvent,
    AttendanceShift,
    PayrollExportRecord,
)
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.schemas import (
    ActiveGeofence,
    AdjustmentItem,
    AdjustmentRequest,
    AdjustmentResponse,
    Board,
    BoardRow,
    Geofence,
    GeofenceUpdate,
    Grid,
    GridCell,
    GridRow,
    PayrollDay,
    PayrollExport,
    PayrollExportFile,
    PingBatch,
    PingBatchResponse,
    PingRequest,
    PresenceItem,
    PresenceRequest,
    PresenceResponse,
    PunchItem,
    PunchRequest,
    PunchResponse,
    SelfieGap,
    Shift,
    ShiftUpdate,
    SignedSelfie,
    TechDay,
    TechDays,
    TodayStatus,
    VarianceReport,
    VarianceRow,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_SELFIE_BYTES = 5 * 1024 * 1024
DEFAULT_DRIFT_FLAG_SECONDS = 120
DEFAULT_ACCURACY_CEILING_M = 200.0
DEFAULT_SELFIE_GRACE_HOURS = 24
# D8 device-clock trust window (see _effective_time). Defaults mirror
# core.config; the migration 0018 backfill hard-codes the same literals.
DEFAULT_DEVICE_TIME_FUTURE_TOLERANCE_SECONDS = 120
DEFAULT_DEVICE_TIME_BACKDATE_CEILING_HOURS = 24
# On-duty ping cadence (minutes). Surfaced on ActiveGeofence so the phone paces
# to it; the same value drives the server's missing-ping (2×) math.
DEFAULT_PING_INTERVAL_MINUTES = 5
# How far back the selfie-gaps reconciliation looks. Bounds the list so punches
# from before the selfie-evidence policy don't surface forever.
SELFIE_GAP_LOOKBACK_DAYS = 14


class AttendanceNotFoundError(LookupError):
    """Raised when an event/selfie is not found for the given owner."""


@dataclass(frozen=True)
class DayFlags:
    """One tech-day's evidence flags. Computed in ONE place (``_day_flags``) so
    the board, the monthly grid, and the payroll export all carry the same
    anti-cheat signals — a flag that only the today-board shows is a flag the
    payroll decision never sees."""

    mock: bool
    outside: bool
    drift: bool
    no_location: bool
    no_selfie: bool
    wifi_match: bool | None


class SelfieTooLargeError(ValueError):
    """Raised when a finalized selfie exceeds the configured ceiling."""


# ── Weekly payroll export (the Sunday cycle) ──────────────────────────────────
def payroll_week_window(today: date) -> tuple[date, date]:
    """The Mon→Sun week ending on the most recent Sunday (or ``today`` if it IS
    Sunday — the scheduler fires Sunday evening, exporting the week just done)."""
    # Monday=0 … Sunday=6
    days_past_sunday = (today.weekday() + 1) % 7
    sunday = today - timedelta(days=days_past_sunday)
    return sunday - timedelta(days=6), sunday


def payroll_csv(export: PayrollExport, tech_names: dict[str, str] | None = None) -> str:
    """The same flat shape the manager web builds for its on-demand download —
    one row per tech per day, ERP-friendly. The evidence flags ride along so
    the document a pay decision is made from carries the anti-cheat signals,
    not just the today-board. ``tech_names`` (when given) fills the leading
    human-readable ``technician`` column, falling back to the id; ``hours`` is
    ``worked_minutes`` as a decimal so the sheet is payroll-ready without a
    formula."""
    names = tech_names or {}
    buf = io_module.StringIO()
    writer = csv_module.writer(buf, lineterminator="\n")
    writer.writerow(
        [
            "technician",
            "tech_id",
            "date",
            "status",
            "first_in",
            "last_out",
            "worked_minutes",
            "hours",
            "flag_mock_gps",
            "flag_outside_geofence",
            "flag_clock_drift",
            "flag_no_location",
            "flag_no_selfie",
            "flag_order",
        ]
    )
    for row in export.rows:
        writer.writerow(
            [
                names.get(row.tech_id, row.tech_id),
                row.tech_id,
                row.date.isoformat(),
                row.status,
                row.first_in.isoformat() if row.first_in else "",
                row.last_out.isoformat() if row.last_out else "",
                row.worked_minutes if row.worked_minutes is not None else "",
                f"{row.worked_minutes / 60:.1f}" if row.worked_minutes is not None else "",
                int(row.flagged_mock),
                int(row.flagged_outside),
                int(row.flagged_drift),
                int(row.flagged_no_location),
                int(row.flagged_no_selfie),
                int(row.flagged_order),
            ]
        )
    return buf.getvalue()


class AttendanceService:
    def __init__(
        self,
        repo: AttendanceRepository,
        storage: StorageClient,
        *,
        selfie_max_bytes: int = DEFAULT_MAX_SELFIE_BYTES,
        drift_flag_seconds: int = DEFAULT_DRIFT_FLAG_SECONDS,
        location_accuracy_ceiling_m: float = DEFAULT_ACCURACY_CEILING_M,
        selfie_grace_hours: int = DEFAULT_SELFIE_GRACE_HOURS,
        device_time_future_tolerance_seconds: int = DEFAULT_DEVICE_TIME_FUTURE_TOLERANCE_SECONDS,
        device_time_backdate_ceiling_hours: int = DEFAULT_DEVICE_TIME_BACKDATE_CEILING_HOURS,
        ping_interval_minutes: int = DEFAULT_PING_INTERVAL_MINUTES,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._selfie_max_bytes = selfie_max_bytes
        self._drift_flag_seconds = drift_flag_seconds
        self._accuracy_ceiling_m = location_accuracy_ceiling_m
        self._selfie_grace_hours = selfie_grace_hours
        self._device_time_future_tolerance_seconds = device_time_future_tolerance_seconds
        self._device_time_backdate_ceiling_hours = device_time_backdate_ceiling_hours
        self._ping_interval_minutes = ping_interval_minutes

    # ── Commands ─────────────────────────────────────────────────────────
    async def record_punch(self, body: PunchRequest) -> PunchResponse:
        """Record a punch. Idempotent on ``client_id`` so offline retries are
        safe: a re-sent punch returns the existing row (and re-mints the selfie
        upload URL if the photo is still pending)."""
        existing = await self._repo.get_event_by_client_id(body.client_id)
        if existing is not None:
            return self._punch_response(
                existing,
                selfie=self._resume_selfie(existing, content_type=body.selfie_content_type),
                deduped=True,
            )

        server_now = datetime.now(UTC)
        drift = _compute_drift(server_now, body.device_time)
        effective = self._effective(body.device_time, server_now)

        inside, distance, wifi_match = await self._evaluate_geofence(
            shop_id=body.shop_id,
            lat=body.lat,
            lng=body.lng,
            accuracy_m=body.accuracy_m,
            wifi_bssid=body.wifi_bssid,
        )

        selfie_path: str | None = None
        if body.selfie_filename is not None:
            ext = PurePosixPath(body.selfie_filename).suffix.lstrip(".").lower() or "jpg"
            selfie_path = f"attendance/{body.shop_id}/{body.tech_id}/{uuid4()}.{ext}"

        try:
            event = await self._repo.create_event(
                client_id=body.client_id,
                shop_id=body.shop_id,
                tech_id=body.tech_id,
                kind=body.kind,
                source="mobile",
                server_time=server_now,
                device_time=body.device_time,
                effective_time=effective,
                drift_seconds=drift,
                lat=body.lat,
                lng=body.lng,
                accuracy_m=body.accuracy_m,
                inside_geofence=inside,
                distance_m=distance,
                is_mock_location=body.is_mock_location,
                selfie_path=selfie_path,
                selfie_status="pending",
                created_by=body.tech_id,
                wifi_bssid=body.wifi_bssid,
                wifi_ssid=body.wifi_ssid,
                wifi_match=wifi_match,
            )
        except IntegrityError:
            # A concurrent request inserted the same client_id between our
            # dedup check above and this insert (double-tap / two devices). The
            # UNIQUE(client_id) constraint caught it — recover by treating it as
            # the no-op it is, rather than surfacing a 500.
            await self._repo.rollback()
            raced = await self._repo.get_event_by_client_id(body.client_id)
            if raced is None:
                raise
            return self._punch_response(
                raced,
                selfie=self._resume_selfie(raced, content_type=body.selfie_content_type),
                deduped=True,
            )

        signed: SignedSelfie | None = None
        if selfie_path is not None:
            minted = self._storage.mint_upload_url(
                selfie_path, content_type=body.selfie_content_type or "image/jpeg"
            )
            signed = SignedSelfie(
                signed_url=minted.signed_url,
                storage_path=selfie_path,
                expires_in=minted.expires_in or DEFAULT_UPLOAD_TTL,
            )
        return self._punch_response(event, selfie=signed, deduped=False)

    async def record_presence(self, body: PresenceRequest) -> PresenceResponse:
        """Log a passive geofence crossing (``arrive`` / ``depart``). Idempotent
        on ``client_id`` so the phone's offline retries are safe no-ops. Computes
        the SAME fence verdict as a punch (shared ``_evaluate_geofence``), but
        writes to the separate presence log — it is evidence of where the phone
        was, never a clock-in, and never feeds worked-minutes."""
        existing = await self._repo.get_presence_by_client_id(body.client_id)
        if existing is not None:
            return self._presence_response(existing, deduped=True)

        server_now = datetime.now(UTC)
        drift = _compute_drift(server_now, body.device_time)
        effective = self._effective(body.device_time, server_now)
        inside, distance, wifi_match = await self._evaluate_geofence(
            shop_id=body.shop_id,
            lat=body.lat,
            lng=body.lng,
            accuracy_m=body.accuracy_m,
            wifi_bssid=body.wifi_bssid,
        )

        try:
            event = await self._repo.create_presence(
                client_id=body.client_id,
                shop_id=body.shop_id,
                tech_id=body.tech_id,
                kind=body.kind,
                device_time=body.device_time,
                effective_time=effective,
                drift_seconds=drift,
                lat=body.lat,
                lng=body.lng,
                accuracy_m=body.accuracy_m,
                inside_geofence=inside,
                distance_m=distance,
                is_mock_location=body.is_mock_location,
                wifi_bssid=body.wifi_bssid,
                wifi_ssid=body.wifi_ssid,
                wifi_match=wifi_match,
                confirmed=body.confirmed,
            )
        except IntegrityError:
            # Same race the punch path guards: a concurrent insert won the
            # UNIQUE(client_id). Recover as the no-op it is.
            await self._repo.rollback()
            raced = await self._repo.get_presence_by_client_id(body.client_id)
            if raced is None:
                raise
            return self._presence_response(raced, deduped=True)
        return self._presence_response(event, deduped=False)

    async def record_pings(self, body: PingBatch) -> PingBatchResponse:
        """Store a batch of on-duty pings. Idempotent per ``client_id`` via the
        repository's ``ON CONFLICT DO NOTHING`` — a re-sent (overlapping) batch
        is a safe no-op. The active fence is fetched ONCE and every ping is
        judged in-process (not ``_evaluate_geofence``, which queries per call),
        so a 100-ping batch is one fence read, not a hundred."""
        if not body.pings:
            return PingBatchResponse(
                accepted=0, deduped=0, ping_interval_minutes=self._ping_interval_minutes
            )
        geofence = await self._repo.get_active_geofence(shop_id=body.pings[0].shop_id)
        rows: list[dict[str, object]] = []
        for p in body.pings:
            inside, distance, wifi_match = self._evaluate_ping(p, geofence)
            rows.append(
                {
                    "client_id": p.client_id,
                    "shop_id": p.shop_id,
                    "tech_id": p.tech_id,
                    "captured_at": p.captured_at,
                    "lat": p.lat,
                    "lng": p.lng,
                    "accuracy_m": p.accuracy_m,
                    "inside_geofence": inside,
                    "distance_m": distance,
                    "is_mock_location": p.is_mock_location,
                    "wifi_bssid": p.wifi_bssid,
                    "wifi_ssid": p.wifi_ssid,
                    "wifi_match": wifi_match,
                }
            )
        accepted = await self._repo.create_pings(rows)
        return PingBatchResponse(
            accepted=accepted,
            deduped=len(rows) - accepted,
            ping_interval_minutes=self._ping_interval_minutes,
        )

    async def complete_selfie(
        self, *, tech_id: str, event_id: UUID, size_bytes: int | None
    ) -> PunchItem:
        """Finalize a selfie after the phone PUT to R2 succeeded. Oversized
        photos are purged and dropped — but the punch itself stays valid."""
        event = await self._load_owned(tech_id, event_id)
        if event.selfie_path is None:
            raise AttendanceNotFoundError(f"no pending selfie for event {event_id}")

        # Trust R2's real byte count over the client-reported size (which a
        # client could under-report to slip a huge file past the ceiling);
        # fall back to the reported value only if the HEAD can't be read.
        actual = self._storage.head_size(event.selfie_path)
        effective = actual if actual is not None else size_bytes

        if effective is not None and effective > self._selfie_max_bytes:
            path = event.selfie_path
            try:
                self._storage.delete(path)
            except Exception:  # noqa: BLE001 — best-effort purge of the rejected object
                logger.warning("failed to purge oversized selfie %s", path, exc_info=True)
            await self._repo.reject_selfie(event)
            raise SelfieTooLargeError(
                f"selfie {effective} bytes exceeds limit {self._selfie_max_bytes}"
            )

        await self._repo.finalize_selfie(event, size_bytes=effective)
        return self._to_item(event)

    async def create_adjustment(self, body: AdjustmentRequest) -> AdjustmentResponse:
        """Manager correction: append a NEW manual event + an audit row. The
        log is never edited."""
        if body.original_event_id is not None:
            original = await self._repo.get_event(body.original_event_id)
            if original is None or original.shop_id != body.shop_id:
                raise AttendanceNotFoundError(f"event {body.original_event_id} not found")

        event = await self._repo.create_event(
            client_id=uuid4(),
            shop_id=body.shop_id,
            tech_id=body.tech_id,
            kind=body.kind,
            source="manual",
            server_time=body.server_time,
            # A manager correction asserts *when it happened*; there is no device
            # clock to reconcile, so the corrected time is the effective time.
            effective_time=body.server_time,
            device_time=None,
            drift_seconds=None,
            lat=None,
            lng=None,
            accuracy_m=None,
            inside_geofence=None,
            distance_m=None,
            is_mock_location=False,
            selfie_path=None,
            selfie_status="pending",
            created_by=body.manager_id,
        )
        adjustment = await self._repo.create_adjustment(
            original_event_id=body.original_event_id,
            new_event_id=event.id,
            manager_id=body.manager_id,
            reason=body.reason,
        )
        return AdjustmentResponse(
            adjustment_id=adjustment.id,
            new_event_id=event.id,
            original_event_id=body.original_event_id,
        )

    async def list_adjustments(
        self,
        *,
        shop_id: str,
        tech_id: str | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[AdjustmentItem]:
        rows = await self._repo.list_adjustments(
            shop_id=shop_id, tech_id=tech_id, start=start, end=end
        )
        return [
            AdjustmentItem(
                id=adj.id,
                tech_id=ev.tech_id,
                kind=ev.kind,  # type: ignore[arg-type]
                server_time=ev.server_time,
                original_event_id=adj.original_event_id,
                reason=adj.reason,
                manager_id=adj.manager_id,
                created_at=adj.created_at,
            )
            for adj, ev in rows
        ]

    # ── Queries: technician ──────────────────────────────────────────────
    async def today_status(self, *, tech_id: str, shop_id: str) -> TodayStatus:
        tz = await self._shop_tz(shop_id)
        today = datetime.now(UTC).astimezone(tz).date()
        start, end = _local_day_window_utc(today, tz)
        events = await self._repo.list_events(
            shop_id=shop_id, start=start, end=end, tech_id=tech_id
        )
        last_in = _latest(events, "clock_in")
        last_out = _latest(events, "clock_out")
        clocked_in = last_in is not None and (
            last_out is None or last_in.effective_time > last_out.effective_time
        )
        return TodayStatus(
            tech_id=tech_id,
            clocked_in=clocked_in,
            last_in=last_in.effective_time if last_in else None,
            last_out=last_out.effective_time if last_out else None,
        )

    async def list_punches(
        self, *, tech_id: str, shop_id: str, start: datetime, end: datetime
    ) -> list[PunchItem]:
        events = await self._repo.list_events(
            shop_id=shop_id, start=start, end=end, tech_id=tech_id
        )
        return [self._to_item(e) for e in events]

    # ── Queries: manager ─────────────────────────────────────────────────
    async def board(
        self, *, shop_id: str, day: date | None = None, tech_ids: list[str] | None = None
    ) -> Board:
        tz, shifts = await self._tz_and_shifts(shop_id)
        if day is None:
            day = datetime.now(UTC).astimezone(tz).date()
        bucket, roster = await self._window(shop_id, day, day, tz, tech_ids, set(shifts))
        start, end = _local_day_window_utc(day, tz)
        pbucket = await self._presence_by_tech(shop_id=shop_id, start=start, end=end, tz=tz)
        rows: list[BoardRow] = []
        for tech_id in roster:
            events = bucket.get(tech_id, {}).get(day, [])
            roll = classify_day(
                day=day, punches=_local_punches(events, tz), shift=_shift_for(tech_id, shifts)
            )
            flags = self._day_flags(events)
            day_presence = pbucket.get(tech_id, {}).get(day, [])
            arrived_not_in = any(p.kind == "arrive" for p in day_presence) and not any(
                e.kind == "clock_in" for e in events
            )
            rows.append(
                BoardRow(
                    tech_id=tech_id,
                    status=roll.status,  # type: ignore[arg-type]
                    late=roll.late,
                    first_in=roll.first_in,
                    last_out=roll.last_out,
                    worked_minutes=roll.worked_minutes,
                    wifi_match=flags.wifi_match,
                    flagged_mock=flags.mock,
                    flagged_outside=flags.outside,
                    flagged_drift=flags.drift,
                    flagged_no_location=flags.no_location,
                    flagged_no_selfie=flags.no_selfie,
                    flagged_arrived_not_clocked_in=arrived_not_in,
                    flagged_order=roll.order_violation,
                )
            )
        return Board(shop_id=shop_id, date=day, rows=rows)

    async def grid(self, *, shop_id: str, month: str, tech_ids: list[str] | None = None) -> Grid:
        tz, shifts = await self._tz_and_shifts(shop_id)
        first, last = _month_bounds(month, tz)
        bucket, roster = await self._window(shop_id, first, last, tz, tech_ids, set(shifts))
        days = _date_range(first, last)
        rows: list[GridRow] = []
        for tech_id in roster:
            shift = _shift_for(tech_id, shifts)
            cells: list[GridCell] = []
            present = working = 0
            for d in days:
                events = bucket.get(tech_id, {}).get(d, [])
                roll = classify_day(day=d, punches=_local_punches(events, tz), shift=shift)
                flags = self._day_flags(events)
                cells.append(
                    GridCell(
                        day=d,
                        status=roll.status,  # type: ignore[arg-type]
                        late=roll.late,
                        flagged_mock=flags.mock,
                        flagged_outside=flags.outside,
                        flagged_drift=flags.drift,
                        flagged_no_location=flags.no_location,
                        flagged_no_selfie=flags.no_selfie,
                        flagged_order=roll.order_violation,
                    )
                )
                if roll.status != "holiday":
                    working += 1
                if roll.status in ("present", "field", "half"):
                    present += 1
            rows.append(GridRow(tech_id=tech_id, present=present, working=working, cells=cells))
        return Grid(shop_id=shop_id, month=month, rows=rows)

    async def tech_days(
        self, *, tech_id: str, shop_id: str, from_date: date, to_date: date
    ) -> TechDays:
        tz, shifts = await self._tz_and_shifts(shop_id)
        # classify_day mislabels a future day with no punches as "absent", so
        # never roll past today (board/grid already cap their ranges).
        today = datetime.now(UTC).astimezone(tz).date()
        if to_date > today:
            to_date = today
        bucket, _ = await self._window(shop_id, from_date, to_date, tz, [tech_id], set(shifts))
        start, _ = _local_day_window_utc(from_date, tz)
        _, end = _local_day_window_utc(to_date, tz)
        pbucket = await self._presence_by_tech(
            shop_id=shop_id, start=start, end=end, tz=tz, tech_id=tech_id
        )
        shift = _shift_for(tech_id, shifts)
        days: list[TechDay] = []
        for d in _date_range(from_date, to_date):
            events = bucket.get(tech_id, {}).get(d, [])
            day_presence = pbucket.get(tech_id, {}).get(d, [])
            roll = classify_day(day=d, punches=_local_punches(events, tz), shift=shift)
            arrived = any(p.kind == "arrive" for p in day_presence)
            clocked_in = any(e.kind == "clock_in" for e in events)
            days.append(
                TechDay(
                    day=d,
                    status=roll.status,  # type: ignore[arg-type]
                    late=roll.late,
                    first_in=roll.first_in,
                    last_out=roll.last_out,
                    worked_minutes=roll.worked_minutes,
                    punches=[self._to_item(e) for e in events],
                    presence=[PresenceItem.model_validate(p) for p in day_presence],
                    arrived_not_clocked_in=arrived and not clocked_in,
                    flagged_order=roll.order_violation,
                )
            )
        return TechDays(tech_id=tech_id, from_date=from_date, to_date=to_date, days=days)

    async def payroll(
        self,
        *,
        shop_id: str,
        from_date: date,
        to_date: date,
        tech_ids: list[str] | None = None,
    ) -> PayrollExport:
        """Flat per-tech, per-day attendance over a range — the basis for the
        weekly payroll/ERP export. Reuses the same rollup as the board/grid."""
        tz, shifts = await self._tz_and_shifts(shop_id)
        today = datetime.now(UTC).astimezone(tz).date()
        if to_date > today:  # never roll past today (classify_day would mislabel)
            to_date = today
        bucket, roster = await self._window(shop_id, from_date, to_date, tz, tech_ids, set(shifts))
        rows: list[PayrollDay] = []
        for tech_id in roster:
            shift = _shift_for(tech_id, shifts)
            for d in _date_range(from_date, to_date):
                events = bucket.get(tech_id, {}).get(d, [])
                roll = classify_day(day=d, punches=_local_punches(events, tz), shift=shift)
                flags = self._day_flags(events)
                rows.append(
                    PayrollDay(
                        tech_id=tech_id,
                        date=d,
                        status=roll.status,  # type: ignore[arg-type]
                        first_in=roll.first_in,
                        last_out=roll.last_out,
                        worked_minutes=roll.worked_minutes,
                        flagged_mock=flags.mock,
                        flagged_outside=flags.outside,
                        flagged_drift=flags.drift,
                        flagged_no_location=flags.no_location,
                        flagged_no_selfie=flags.no_selfie,
                        flagged_order=roll.order_violation,
                    )
                )
        return PayrollExport(shop_id=shop_id, from_date=from_date, to_date=to_date, rows=rows)

    # ── Variance report (system evidence vs manual punches) ──────────────
    async def variance(
        self,
        *,
        shop_id: str,
        from_date: date,
        to_date: date,
        tech_ids: list[str] | None = None,
    ) -> VarianceReport:
        """Per tech/day, line the system's geofence crossings (and Step 7 pings)
        up against the manual punches, exposing the arrival/departure deltas a
        manager reviews. All times/deltas are on ``effective_time`` so sync
        latency never masquerades as attendance variance; a delta is null when
        either side is missing. Holiday rows are omitted; ``to_date`` is clamped
        to today like the payroll export."""
        tz, shifts = await self._tz_and_shifts(shop_id)
        today = datetime.now(UTC).astimezone(tz).date()
        if to_date > today:  # classify_day would mislabel a future day
            to_date = today
        bucket, roster = await self._window(shop_id, from_date, to_date, tz, tech_ids, set(shifts))
        start, _ = _local_day_window_utc(from_date, tz)
        _, end = _local_day_window_utc(to_date, tz)
        pbucket = await self._presence_by_tech(shop_id=shop_id, start=start, end=end, tz=tz)
        rows: list[VarianceRow] = []
        for tech_id in roster:
            shift = _shift_for(tech_id, shifts)
            for d in _date_range(from_date, to_date):
                events = bucket.get(tech_id, {}).get(d, [])
                day_presence = pbucket.get(tech_id, {}).get(d, [])
                roll = classify_day(day=d, punches=_local_punches(events, tz), shift=shift)
                if roll.status == "holiday":
                    continue  # a non-working day carries no variance to review
                arrivals = [
                    _local_naive(p.effective_time, tz) for p in day_presence if p.kind == "arrive"
                ]
                departures = [
                    _local_naive(p.effective_time, tz) for p in day_presence if p.kind == "depart"
                ]
                first_arrive = min(arrivals) if arrivals else None
                last_depart = max(departures) if departures else None
                rows.append(
                    VarianceRow(
                        tech_id=tech_id,
                        date=d,
                        status=roll.status,  # type: ignore[arg-type]
                        first_arrive=first_arrive,
                        first_clock_in=roll.first_in,
                        delta_in_minutes=_delta_minutes(roll.first_in, first_arrive),
                        last_depart=last_depart,
                        last_clock_out=roll.last_out,
                        delta_out_minutes=_delta_minutes(last_depart, roll.last_out),
                        clocked_minutes=roll.worked_minutes,
                        flagged_arrived_not_clocked_in=bool(arrivals)
                        and not any(e.kind == "clock_in" for e in events),
                        flagged_order=roll.order_violation,
                    )
                )
        return VarianceReport(shop_id=shop_id, from_date=from_date, to_date=to_date, rows=rows)

    # ── Selfie evidence reconciliation ───────────────────────────────────
    async def selfie_gaps(self, *, shop_id: str) -> list[SelfieGap]:
        """Mobile punches past the grace window whose selfie never reached
        storage. The back half of "selfie is required evidence" without ever
        blocking a punch: capture is best-effort and offline-tolerant, but a
        gap must surface to the manager instead of passing silently (the same
        bargain as the jobs closing-video evidence-gaps)."""
        now = datetime.now(UTC)
        events = await self._repo.list_punches_missing_selfie(
            shop_id=shop_id,
            since=now - timedelta(days=SELFIE_GAP_LOOKBACK_DAYS),
            before=now - timedelta(hours=self._selfie_grace_hours),
        )
        return [
            SelfieGap(
                event_id=e.id,
                tech_id=e.tech_id,
                kind=e.kind,  # type: ignore[arg-type]
                server_time=e.server_time,
                # True = a photo was promised (path reserved) but bytes never
                # landed; False = no photo was ever attached.
                selfie_attached=e.selfie_path is not None,
            )
            for e in events
        ]

    # ── Config: shift / geofence ─────────────────────────────────────────
    async def get_shift(self, *, shop_id: str, tech_id: str) -> Shift:
        row = await self._repo.get_shift(shop_id=shop_id, tech_id=tech_id)
        if row is None:
            return Shift(
                shop_id=shop_id,
                tech_id=tech_id,
                start_local=DEFAULT_SHIFT.start_local,
                end_local=DEFAULT_SHIFT.end_local,
                working_days=DEFAULT_SHIFT.working_days,
                grace_minutes=DEFAULT_SHIFT.grace_minutes,
                timezone=DEFAULT_TIMEZONE,
            )
        return Shift.model_validate(row)

    async def upsert_shift(self, *, shop_id: str, tech_id: str, body: ShiftUpdate) -> Shift:
        row = await self._repo.upsert_shift(
            shop_id=shop_id,
            tech_id=tech_id,
            start_local=body.start_local,
            end_local=body.end_local,
            working_days=body.working_days,
            grace_minutes=body.grace_minutes,
            timezone=body.timezone,
        )
        return Shift.model_validate(row)

    async def get_geofence(self, *, shop_id: str) -> Geofence | None:
        row = await self._repo.get_geofence(shop_id=shop_id)
        return Geofence.model_validate(row) if row is not None else None

    async def active_geofence(self, *, shop_id: str) -> ActiveGeofence | None:
        """The active geofence, trimmed for the technician app (no wifi list).
        Drives the phone's OS-level geofencing; ``None`` = nothing to monitor."""
        row = await self._repo.get_active_geofence(shop_id=shop_id)
        if row is None:
            return None
        return ActiveGeofence(
            name=row.name,
            center_lat=row.center_lat,
            center_lng=row.center_lng,
            radius_m=row.radius_m,
            is_active=row.is_active,
            ping_interval_minutes=self._ping_interval_minutes,
        )

    async def upsert_geofence(self, *, shop_id: str, body: GeofenceUpdate) -> Geofence:
        row = await self._repo.upsert_geofence(
            shop_id=shop_id,
            name=body.name,
            center_lat=body.center_lat,
            center_lng=body.center_lng,
            radius_m=body.radius_m,
            is_active=body.is_active,
            wifi_bssids=body.wifi_bssids,
        )
        return Geofence.model_validate(row)

    # ── Internals ────────────────────────────────────────────────────────
    async def _evaluate_geofence(
        self,
        *,
        shop_id: str,
        lat: float | None,
        lng: float | None,
        accuracy_m: float | None,
        wifi_bssid: str | None,
    ) -> tuple[bool | None, float | None, bool | None]:
        """Judge a fix against the shop's active geofence. Shared verbatim by
        punches and presence crossings, so a clock-in and an ``arrive`` taken at
        the same spot agree. Returns ``(inside, distance_m, wifi_match)``; any is
        ``None`` when there is nothing to judge — no active fence, no coords, or
        a fix too coarse to trust (the accuracy ceiling, where a false
        inside/outside verdict is worse than an honest "unknown")."""
        inside: bool | None = None
        distance: float | None = None
        wifi_match: bool | None = None
        if (lat is not None and lng is not None) or wifi_bssid is not None:
            geofence = await self._repo.get_active_geofence(shop_id=shop_id)
            if geofence is not None:
                if lat is not None and lng is not None:
                    inside, distance = geofence_flags(
                        lat,
                        lng,
                        center_lat=geofence.center_lat,
                        center_lng=geofence.center_lng,
                        radius_m=geofence.radius_m,
                        accuracy_m=accuracy_m or 0.0,
                    )
                    if accuracy_m is None or accuracy_m > self._accuracy_ceiling_m:
                        inside = None
                if wifi_bssid is not None and geofence.wifi_bssids:
                    wifi_match = _wifi_match(wifi_bssid, geofence.wifi_bssids)
        return inside, distance, wifi_match

    def _evaluate_ping(
        self, ping: PingRequest, geofence: AttendanceGeofence | None
    ) -> tuple[bool | None, float | None, bool | None]:
        """Judge one ping against a PRE-FETCHED fence — the batch fetches the
        fence once and evaluates every ping in-process. Same rules as
        ``_evaluate_geofence``: overlap-aware inside/outside, the accuracy
        ceiling collapses a coarse fix to ``None``, wifi corroboration."""
        inside: bool | None = None
        distance: float | None = None
        wifi_match: bool | None = None
        if geofence is None:
            return inside, distance, wifi_match
        if ping.lat is not None and ping.lng is not None:
            inside, distance = geofence_flags(
                ping.lat,
                ping.lng,
                center_lat=geofence.center_lat,
                center_lng=geofence.center_lng,
                radius_m=geofence.radius_m,
                accuracy_m=ping.accuracy_m or 0.0,
            )
            if ping.accuracy_m is None or ping.accuracy_m > self._accuracy_ceiling_m:
                inside = None
        if ping.wifi_bssid is not None and geofence.wifi_bssids:
            wifi_match = _wifi_match(ping.wifi_bssid, geofence.wifi_bssids)
        return inside, distance, wifi_match

    def _presence_response(
        self, event: AttendancePresenceEvent, *, deduped: bool
    ) -> PresenceResponse:
        return PresenceResponse(
            event_id=event.id,
            client_id=event.client_id,
            server_time=event.server_time,
            kind=event.kind,  # type: ignore[arg-type]
            inside_geofence=event.inside_geofence,
            distance_m=event.distance_m,
            deduped=deduped,
        )

    async def _presence_by_tech(
        self,
        *,
        shop_id: str,
        start: datetime,
        end: datetime,
        tz: ZoneInfo,
        tech_id: str | None = None,
    ) -> dict[str, dict[date, list[AttendancePresenceEvent]]]:
        """Load + bucket presence crossings by (tech, local day) — mirrors how
        ``_window`` buckets punches, so the board / tech-detail can line a day's
        ``arrive`` against its ``clock_in``."""
        rows = await self._repo.list_presence(
            shop_id=shop_id, start=start, end=end, tech_id=tech_id
        )
        bucket: dict[str, dict[date, list[AttendancePresenceEvent]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for p in rows:
            bucket[p.tech_id][p.effective_time.astimezone(tz).date()].append(p)
        return bucket

    async def _load_owned(self, tech_id: str, event_id: UUID) -> AttendanceEvent:
        event = await self._repo.get_event(event_id)
        if event is None or event.tech_id != tech_id:
            raise AttendanceNotFoundError(f"event {event_id} not found for tech {tech_id}")
        return event

    def _resume_selfie(
        self, event: AttendanceEvent, *, content_type: str | None = None
    ) -> SignedSelfie | None:
        """Re-mint the upload URL for a still-pending selfie on a deduped
        retry. ``content_type`` comes from the re-sent punch body (the event
        row doesn't store it); the default matches the app's PUT fallback."""
        if event.selfie_path is None or event.selfie_status != "pending":
            return None
        minted = self._storage.mint_upload_url(
            event.selfie_path, content_type=content_type or "image/jpeg"
        )
        return SignedSelfie(
            signed_url=minted.signed_url,
            storage_path=event.selfie_path,
            expires_in=minted.expires_in or DEFAULT_UPLOAD_TTL,
        )

    def _punch_response(
        self, event: AttendanceEvent, *, selfie: SignedSelfie | None, deduped: bool
    ) -> PunchResponse:
        return PunchResponse(
            event_id=event.id,
            client_id=event.client_id,
            server_time=event.server_time,
            inside_geofence=event.inside_geofence,
            distance_m=event.distance_m,
            is_mock_location=event.is_mock_location,
            drift_seconds=event.drift_seconds,
            drift_flagged=self._drift_flagged(event.drift_seconds),
            wifi_match=event.wifi_match,
            selfie=selfie,
            deduped=deduped,
        )

    def _to_item(self, event: AttendanceEvent) -> PunchItem:
        item = PunchItem.model_validate(event)
        if event.selfie_status == "uploaded" and event.selfie_path:
            item.selfie_url = self._storage.mint_playback_url(event.selfie_path) or None
        return item

    def _drift_flagged(self, drift_seconds: int | None) -> bool:
        return drift_seconds is not None and abs(drift_seconds) > self._drift_flag_seconds

    def _effective(self, device_time: datetime | None, server_now: datetime) -> datetime:
        """D8 effective_time with this service's configured trust window."""
        return _effective_time(
            device_time,
            server_now,
            future_tolerance_seconds=self._device_time_future_tolerance_seconds,
            backdate_ceiling_hours=self._device_time_backdate_ceiling_hours,
        )

    def _location_unreliable(self, event: AttendanceEvent) -> bool:
        """No usable fix: coords absent (GPS off / permission denied) or the
        reported accuracy is over the ceiling (garbage fix). Either way the
        geofence couldn't be judged — which must be visible, not silent."""
        return (
            event.lat is None
            or event.lng is None
            or event.accuracy_m is None
            or event.accuracy_m > self._accuracy_ceiling_m
        )

    def _day_flags(self, events: list[AttendanceEvent]) -> DayFlags:
        """Fold one tech-day's events into evidence flags. Only ``mobile``
        punches owe location/selfie evidence — manager (``manual``)
        corrections never carry it and must not trip the flags."""
        mobile = [e for e in events if e.source == "mobile"]
        return DayFlags(
            mock=any(e.is_mock_location for e in events),
            outside=any(e.inside_geofence is False for e in events),
            drift=any(self._drift_flagged(e.drift_seconds) for e in events),
            no_location=any(self._location_unreliable(e) for e in mobile),
            no_selfie=any(e.selfie_status != "uploaded" for e in mobile),
            wifi_match=_aggregate_wifi(events),
        )

    async def _shop_tz(self, shop_id: str) -> ZoneInfo:
        shifts = await self._repo.list_shifts(shop_id=shop_id)
        return _tz_from_shifts(shifts)

    async def _tz_and_shifts(self, shop_id: str) -> tuple[ZoneInfo, dict[str, AttendanceShift]]:
        shifts = await self._repo.list_shifts(shop_id=shop_id)
        return _tz_from_shifts(shifts), {s.tech_id: s for s in shifts}

    async def _window(
        self,
        shop_id: str,
        from_date: date,
        to_date: date,
        tz: ZoneInfo,
        tech_ids: list[str] | None,
        shift_techs: set[str],
    ) -> tuple[dict[str, dict[date, list[AttendanceEvent]]], list[str]]:
        start, _ = _local_day_window_utc(from_date, tz)
        _, end = _local_day_window_utc(to_date, tz)
        single = tech_ids[0] if tech_ids and len(tech_ids) == 1 else None
        events = await self._repo.list_events(shop_id=shop_id, start=start, end=end, tech_id=single)
        bucket: dict[str, dict[date, list[AttendanceEvent]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for e in events:
            local_day = e.effective_time.astimezone(tz).date()
            bucket[e.tech_id][local_day].append(e)

        if tech_ids is not None:
            roster = list(tech_ids)
        else:
            # Roster = everyone who punched in the window ∪ everyone with a
            # configured shift. `shift_techs` is passed in (the caller already
            # loaded shifts for the timezone) so we don't re-query them here.
            roster = sorted(set(bucket.keys()) | shift_techs)
        return bucket, roster

    # ── Module-level pure helpers ────────────────────────────────────────────────

    # ── Weekly payroll export ────────────────────────────────────────────
    async def run_weekly_export(self, *, shop_id: str, today: date) -> PayrollExportRecord:
        """Generate last week's CSV into storage and record it. Idempotent on
        the (shop, window) key — a re-run (scheduler restart, manual trigger)
        returns the existing record untouched."""
        from_date, to_date = payroll_week_window(today)
        existing = await self._repo.get_export_for_window(
            shop_id=shop_id, from_date=from_date, to_date=to_date
        )
        if existing is not None:
            return existing

        export = await self.payroll(shop_id=shop_id, from_date=from_date, to_date=to_date)
        # Human-readable names for the leading CSV column (matching the on-demand
        # download the manager web builds). Fetched through the repository so the
        # service never reaches across slices or into the session directly.
        tech_names = await self._repo.list_active_tech_names()
        csv_text = payroll_csv(export, tech_names=tech_names)
        storage_path = f"payroll/{shop_id}/{from_date.isoformat()}_{to_date.isoformat()}.csv"
        self._storage.put_bytes(storage_path, csv_text.encode("utf-8"), "text/csv")
        record = await self._repo.add_export(
            shop_id=shop_id,
            from_date=from_date,
            to_date=to_date,
            storage_path=storage_path,
            row_count=len(export.rows),
        )
        logger.info("payroll export written: %s (%d rows)", storage_path, len(export.rows))
        return record

    async def list_payroll_exports(self, *, shop_id: str) -> list[PayrollExportFile]:
        records = await self._repo.list_exports(shop_id=shop_id)
        return [
            PayrollExportFile(
                id=r.id,
                from_date=r.from_date,
                to_date=r.to_date,
                row_count=r.row_count,
                created_at=r.created_at,
                download_url=self._storage.mint_playback_url(r.storage_path),
            )
            for r in records
        ]


def _compute_drift(server_now: datetime, device_time: datetime | None) -> int | None:
    if device_time is None:
        return None
    if device_time.tzinfo is None:
        device_time = device_time.replace(tzinfo=UTC)
    return int((server_now - device_time).total_seconds())


def _effective_time(
    device_time: datetime | None,
    server_now: datetime,
    *,
    future_tolerance_seconds: int,
    backdate_ceiling_hours: int,
) -> datetime:
    """D8 — the analytical "when it happened" time, trusting the device clock
    only within a sane window around receipt.

    Returns ``device_time`` when it is present and sits inside
    ``[server_now - backdate_ceiling, server_now + future_tolerance]`` — an
    offline capture synced hours later is legitimate and must count on the day
    it happened. Otherwise (no device time, a future timestamp that can't be
    real, or a stale backdate that smells of spoofing) it falls back to the
    authoritative ``server_now``. The separate ``drift_seconds`` flag still
    surfaces every clock disagreement to the manager — this only decides which
    timestamp the rollups bucket on, never hides the mismatch."""
    if device_time is None:
        return server_now
    dt = device_time if device_time.tzinfo is not None else device_time.replace(tzinfo=UTC)
    future_limit = server_now + timedelta(seconds=future_tolerance_seconds)
    backdate_limit = server_now - timedelta(hours=backdate_ceiling_hours)
    if backdate_limit <= dt <= future_limit:
        return dt
    return server_now


def _wifi_match(bssid: str, configured_csv: str) -> bool:
    """Case-insensitive membership of a BSSID in the shop's configured AP list."""
    configured = {b.strip().lower() for b in configured_csv.split(",") if b.strip()}
    return bssid.strip().lower() in configured


def _aggregate_wifi(events: list[AttendanceEvent]) -> bool | None:
    """Board summary: True if any punch matched a known AP, False if all known
    results were misses, None if no WiFi info for the day."""
    flags = [e.wifi_match for e in events if e.wifi_match is not None]
    return any(flags) if flags else None


def _tz_from_shifts(shifts: list[AttendanceShift]) -> ZoneInfo:
    name = shifts[0].timezone if shifts else DEFAULT_TIMEZONE
    return ZoneInfo(name)


def _shift_for(tech_id: str, shifts: dict[str, AttendanceShift]) -> ShiftSpec:
    row = shifts.get(tech_id)
    if row is None:
        return DEFAULT_SHIFT
    return ShiftSpec(
        start_local=row.start_local,
        end_local=row.end_local,
        working_days=row.working_days,
        grace_minutes=row.grace_minutes,
    )


def _local_naive(dt: datetime, tz: ZoneInfo) -> datetime:
    """A UTC instant projected to shop-local wall-clock (naive), matching how
    ``classify_day`` reports ``first_in``/``last_out`` so deltas subtract cleanly."""
    return dt.astimezone(tz).replace(tzinfo=None)


def _delta_minutes(later: datetime | None, earlier: datetime | None) -> int | None:
    """Signed minutes between two naive-local times, truncated toward zero; null
    when either side is missing. Both come from ``effective_time``."""
    if later is None or earlier is None:
        return None
    return int((later - earlier).total_seconds() / 60)


def _local_punches(events: list[AttendanceEvent], tz: ZoneInfo) -> list[LocalPunch]:
    return [
        LocalPunch(
            kind=e.kind,
            local_dt=e.effective_time.astimezone(tz).replace(tzinfo=None),
            inside_geofence=e.inside_geofence,
        )
        for e in events
    ]


def _latest(events: list[AttendanceEvent], kind: str) -> AttendanceEvent | None:
    matches = [e for e in events if e.kind == kind]
    return max(matches, key=lambda e: e.effective_time) if matches else None


def _local_day_window_utc(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start_local = datetime(day.year, day.month, day.day, tzinfo=tz)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def _date_range(start: date, end: date) -> list[date]:
    days: list[date] = []
    d = start
    while d <= end:
        days.append(d)
        d += timedelta(days=1)
    return days


def _month_bounds(month: str, tz: ZoneInfo) -> tuple[date, date]:
    year, mon = (int(part) for part in month.split("-", 1))
    first = date(year, mon, 1)
    last = date(year, mon, calendar.monthrange(year, mon)[1])
    today = datetime.now(UTC).astimezone(tz).date()
    if last > today:
        last = today
    return first, last
