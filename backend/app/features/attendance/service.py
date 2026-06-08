"""Attendance slice — business logic and the public surface for other slices.

Orchestrates the repository (DB) and the storage client (R2, reused from the
media slice for selfies). Ownership is enforced here (callers pass ``tech_id``;
when the auth slice lands this becomes JWT-derived authz). All timezone math
lives here so `derive.py` stays pure.
"""

from __future__ import annotations

import calendar
import logging
from collections import defaultdict
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
from app.features.attendance.models import AttendanceEvent, AttendanceShift
from app.features.attendance.repository import AttendanceRepository
from app.features.attendance.schemas import (
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
    PunchItem,
    PunchRequest,
    PunchResponse,
    Shift,
    ShiftUpdate,
    SignedSelfie,
    TechDay,
    TechDays,
    TodayStatus,
)

logger = logging.getLogger(__name__)

DEFAULT_MAX_SELFIE_BYTES = 5 * 1024 * 1024
DEFAULT_DRIFT_FLAG_SECONDS = 120


class AttendanceNotFoundError(LookupError):
    """Raised when an event/selfie is not found for the given owner."""


class SelfieTooLargeError(ValueError):
    """Raised when a finalized selfie exceeds the configured ceiling."""


class AttendanceService:
    def __init__(
        self,
        repo: AttendanceRepository,
        storage: StorageClient,
        *,
        selfie_max_bytes: int = DEFAULT_MAX_SELFIE_BYTES,
        drift_flag_seconds: int = DEFAULT_DRIFT_FLAG_SECONDS,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._selfie_max_bytes = selfie_max_bytes
        self._drift_flag_seconds = drift_flag_seconds

    # ── Commands ─────────────────────────────────────────────────────────
    async def record_punch(self, body: PunchRequest) -> PunchResponse:
        """Record a punch. Idempotent on ``client_id`` so offline retries are
        safe: a re-sent punch returns the existing row (and re-mints the selfie
        upload URL if the photo is still pending)."""
        existing = await self._repo.get_event_by_client_id(body.client_id)
        if existing is not None:
            return self._punch_response(
                existing, selfie=self._resume_selfie(existing), deduped=True
            )

        server_now = datetime.now(UTC)
        drift = _compute_drift(server_now, body.device_time)

        inside: bool | None = None
        distance: float | None = None
        wifi_match: bool | None = None
        if (body.lat is not None and body.lng is not None) or body.wifi_bssid is not None:
            geofence = await self._repo.get_active_geofence(shop_id=body.shop_id)
            if geofence is not None:
                if body.lat is not None and body.lng is not None:
                    inside, distance = geofence_flags(
                        body.lat,
                        body.lng,
                        center_lat=geofence.center_lat,
                        center_lng=geofence.center_lng,
                        radius_m=geofence.radius_m,
                    )
                if body.wifi_bssid is not None and geofence.wifi_bssids:
                    wifi_match = _wifi_match(body.wifi_bssid, geofence.wifi_bssids)

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
            return self._punch_response(raced, selfie=self._resume_selfie(raced), deduped=True)

        signed: SignedSelfie | None = None
        if selfie_path is not None:
            minted = self._storage.mint_upload_url(selfie_path)
            signed = SignedSelfie(
                signed_url=minted.signed_url,
                storage_path=selfie_path,
                expires_in=minted.expires_in or DEFAULT_UPLOAD_TTL,
            )
        return self._punch_response(event, selfie=signed, deduped=False)

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
            last_out is None or last_in.server_time > last_out.server_time
        )
        return TodayStatus(
            tech_id=tech_id,
            clocked_in=clocked_in,
            last_in=last_in.server_time if last_in else None,
            last_out=last_out.server_time if last_out else None,
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
        rows: list[BoardRow] = []
        for tech_id in roster:
            events = bucket.get(tech_id, {}).get(day, [])
            roll = classify_day(
                day=day, punches=_local_punches(events, tz), shift=_shift_for(tech_id, shifts)
            )
            rows.append(
                BoardRow(
                    tech_id=tech_id,
                    status=roll.status,  # type: ignore[arg-type]
                    late=roll.late,
                    first_in=roll.first_in,
                    last_out=roll.last_out,
                    worked_minutes=roll.worked_minutes,
                    wifi_match=_aggregate_wifi(events),
                    flagged_mock=any(e.is_mock_location for e in events),
                    flagged_outside=any(e.inside_geofence is False for e in events),
                    flagged_drift=any(self._drift_flagged(e.drift_seconds) for e in events),
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
                cells.append(GridCell(day=d, status=roll.status, late=roll.late))  # type: ignore[arg-type]
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
        shift = _shift_for(tech_id, shifts)
        days: list[TechDay] = []
        for d in _date_range(from_date, to_date):
            events = bucket.get(tech_id, {}).get(d, [])
            roll = classify_day(day=d, punches=_local_punches(events, tz), shift=shift)
            days.append(
                TechDay(
                    day=d,
                    status=roll.status,  # type: ignore[arg-type]
                    late=roll.late,
                    first_in=roll.first_in,
                    last_out=roll.last_out,
                    worked_minutes=roll.worked_minutes,
                    punches=[self._to_item(e) for e in events],
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
                rows.append(
                    PayrollDay(
                        tech_id=tech_id,
                        date=d,
                        status=roll.status,  # type: ignore[arg-type]
                        first_in=roll.first_in,
                        last_out=roll.last_out,
                        worked_minutes=roll.worked_minutes,
                    )
                )
        return PayrollExport(shop_id=shop_id, from_date=from_date, to_date=to_date, rows=rows)

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
    async def _load_owned(self, tech_id: str, event_id: UUID) -> AttendanceEvent:
        event = await self._repo.get_event(event_id)
        if event is None or event.tech_id != tech_id:
            raise AttendanceNotFoundError(f"event {event_id} not found for tech {tech_id}")
        return event

    def _resume_selfie(self, event: AttendanceEvent) -> SignedSelfie | None:
        if event.selfie_path is None or event.selfie_status != "pending":
            return None
        minted = self._storage.mint_upload_url(event.selfie_path)
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
            local_day = e.server_time.astimezone(tz).date()
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
def _compute_drift(server_now: datetime, device_time: datetime | None) -> int | None:
    if device_time is None:
        return None
    if device_time.tzinfo is None:
        device_time = device_time.replace(tzinfo=UTC)
    return int((server_now - device_time).total_seconds())


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


def _local_punches(events: list[AttendanceEvent], tz: ZoneInfo) -> list[LocalPunch]:
    return [
        LocalPunch(
            kind=e.kind,
            local_dt=e.server_time.astimezone(tz).replace(tzinfo=None),
            inside_geofence=e.inside_geofence,
        )
        for e in events
    ]


def _latest(events: list[AttendanceEvent], kind: str) -> AttendanceEvent | None:
    matches = [e for e in events if e.kind == kind]
    return max(matches, key=lambda e: e.server_time) if matches else None


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
