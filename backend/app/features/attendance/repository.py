"""Data access for the attendance tables. Stays thin — the service owns all
business logic. Mutating methods ``flush`` (so ids/defaults populate) but never
``commit``; the router commits at the request boundary, like the media slice."""

from __future__ import annotations

from datetime import UTC, datetime, time
from datetime import date as date_type
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.attendance.models import (
    AttendanceAdjustment,
    AttendanceEvent,
    AttendanceGeofence,
    AttendanceShift,
    PayrollExportRecord,
)
from app.features.identity.models import Technician


class AttendanceRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def rollback(self) -> None:
        """Abort the current transaction. Used by the service to recover from a
        raced UNIQUE(client_id) insert and return a clean dedup response."""
        await self._session.rollback()

    # ── Events (append-only) ─────────────────────────────────────────────
    async def create_event(
        self,
        *,
        client_id: UUID,
        shop_id: str,
        tech_id: str,
        kind: str,
        source: str,
        device_time: datetime | None,
        drift_seconds: int | None,
        lat: float | None,
        lng: float | None,
        accuracy_m: float | None,
        inside_geofence: bool | None,
        distance_m: float | None,
        is_mock_location: bool,
        selfie_path: str | None,
        selfie_status: str,
        created_by: str | None,
        wifi_bssid: str | None = None,
        wifi_ssid: str | None = None,
        wifi_match: bool | None = None,
        server_time: datetime | None = None,
    ) -> AttendanceEvent:
        event = AttendanceEvent(
            client_id=client_id,
            shop_id=shop_id,
            tech_id=tech_id,
            kind=kind,
            source=source,
            device_time=device_time,
            drift_seconds=drift_seconds,
            lat=lat,
            lng=lng,
            accuracy_m=accuracy_m,
            inside_geofence=inside_geofence,
            distance_m=distance_m,
            is_mock_location=is_mock_location,
            selfie_path=selfie_path,
            selfie_status=selfie_status,
            created_by=created_by,
            wifi_bssid=wifi_bssid,
            wifi_ssid=wifi_ssid,
            wifi_match=wifi_match,
        )
        # Mobile punches let the DB stamp the authoritative time; manual
        # adjustments pass an explicit (corrected) server_time.
        if server_time is not None:
            event.server_time = server_time
        self._session.add(event)
        await self._session.flush()
        await self._session.refresh(event)
        return event

    async def get_event(self, event_id: UUID) -> AttendanceEvent | None:
        return await self._session.get(AttendanceEvent, event_id)

    async def get_event_by_client_id(self, client_id: UUID) -> AttendanceEvent | None:
        stmt = select(AttendanceEvent).where(AttendanceEvent.client_id == client_id)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def finalize_selfie(self, event: AttendanceEvent, *, size_bytes: int | None) -> None:
        event.selfie_status = "uploaded"
        event.selfie_size_bytes = size_bytes
        await self._session.flush()

    async def reject_selfie(self, event: AttendanceEvent) -> None:
        """Oversized selfie: drop the pointer but keep the punch (valid without it)."""
        event.selfie_path = None
        event.selfie_status = "pending"
        event.selfie_size_bytes = None
        await self._session.flush()

    async def list_events(
        self,
        *,
        shop_id: str,
        start: datetime,
        end: datetime,
        tech_id: str | None = None,
    ) -> list[AttendanceEvent]:
        stmt = (
            select(AttendanceEvent)
            .where(AttendanceEvent.shop_id == shop_id)
            .where(AttendanceEvent.server_time >= start)
            .where(AttendanceEvent.server_time < end)
        )
        if tech_id is not None:
            stmt = stmt.where(AttendanceEvent.tech_id == tech_id)
        stmt = stmt.order_by(AttendanceEvent.server_time.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def list_punches_missing_selfie(
        self, *, shop_id: str, since: datetime, before: datetime, limit: int = 200
    ) -> list[AttendanceEvent]:
        """Mobile punches in ``[since, before)`` whose selfie never reached
        storage (status still ``pending``) — the selfie-gaps reconciliation
        feed. ``since`` bounds the lookback so history from before the
        selfie-evidence policy doesn't pile up forever; manual adjustments
        never owe a selfie, so only ``mobile`` rows qualify. Newest first;
        capped so the endpoint stays bounded."""
        stmt = (
            select(AttendanceEvent)
            .where(AttendanceEvent.shop_id == shop_id)
            .where(AttendanceEvent.source == "mobile")
            .where(AttendanceEvent.selfie_status != "uploaded")
            .where(AttendanceEvent.server_time >= since)
            .where(AttendanceEvent.server_time < before)
            .order_by(AttendanceEvent.server_time.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    # ── Shifts ───────────────────────────────────────────────────────────
    async def get_shift(self, *, shop_id: str, tech_id: str) -> AttendanceShift | None:
        stmt = (
            select(AttendanceShift)
            .where(AttendanceShift.shop_id == shop_id)
            .where(AttendanceShift.tech_id == tech_id)
            .where(AttendanceShift.deleted_at.is_(None))
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_shifts(self, *, shop_id: str) -> list[AttendanceShift]:
        stmt = (
            select(AttendanceShift)
            .where(AttendanceShift.shop_id == shop_id)
            .where(AttendanceShift.deleted_at.is_(None))
        )
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def upsert_shift(
        self,
        *,
        shop_id: str,
        tech_id: str,
        start_local: time,
        end_local: time,
        working_days: str,
        grace_minutes: int,
        timezone: str,
    ) -> AttendanceShift:
        shift = await self.get_shift(shop_id=shop_id, tech_id=tech_id)
        if shift is None:
            shift = AttendanceShift(shop_id=shop_id, tech_id=tech_id)
            self._session.add(shift)
        shift.start_local = start_local
        shift.end_local = end_local
        shift.working_days = working_days
        shift.grace_minutes = grace_minutes
        shift.timezone = timezone
        shift.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.refresh(shift)
        return shift

    # ── Geofence ─────────────────────────────────────────────────────────
    async def get_active_geofence(self, *, shop_id: str) -> AttendanceGeofence | None:
        stmt = (
            select(AttendanceGeofence)
            .where(AttendanceGeofence.shop_id == shop_id)
            .where(AttendanceGeofence.is_active.is_(True))
            .where(AttendanceGeofence.deleted_at.is_(None))
            .order_by(AttendanceGeofence.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def get_geofence(self, *, shop_id: str) -> AttendanceGeofence | None:
        stmt = (
            select(AttendanceGeofence)
            .where(AttendanceGeofence.shop_id == shop_id)
            .where(AttendanceGeofence.deleted_at.is_(None))
            .order_by(AttendanceGeofence.created_at.desc())
        )
        result = await self._session.execute(stmt)
        return result.scalars().first()

    async def upsert_geofence(
        self,
        *,
        shop_id: str,
        name: str,
        center_lat: float,
        center_lng: float,
        radius_m: int,
        is_active: bool,
        wifi_bssids: str | None,
    ) -> AttendanceGeofence:
        geofence = await self.get_geofence(shop_id=shop_id)
        if geofence is None:
            geofence = AttendanceGeofence(shop_id=shop_id)
            self._session.add(geofence)
        geofence.name = name
        geofence.center_lat = center_lat
        geofence.center_lng = center_lng
        geofence.radius_m = radius_m
        geofence.is_active = is_active
        geofence.wifi_bssids = wifi_bssids
        geofence.updated_at = datetime.now(UTC)
        await self._session.flush()
        await self._session.refresh(geofence)
        return geofence

    # ── Adjustments ──────────────────────────────────────────────────────
    async def create_adjustment(
        self,
        *,
        original_event_id: UUID | None,
        new_event_id: UUID,
        manager_id: str,
        reason: str,
    ) -> AttendanceAdjustment:
        adjustment = AttendanceAdjustment(
            original_event_id=original_event_id,
            new_event_id=new_event_id,
            manager_id=manager_id,
            reason=reason,
        )
        self._session.add(adjustment)
        await self._session.flush()
        await self._session.refresh(adjustment)
        return adjustment

    async def list_adjustments(
        self,
        *,
        shop_id: str,
        tech_id: str | None = None,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[tuple[AttendanceAdjustment, AttendanceEvent]]:
        """Adjustments joined to the new (corrected) event they created, so the
        audit trail can show the tech/kind/time alongside the reason."""
        stmt = (
            select(AttendanceAdjustment, AttendanceEvent)
            .join(AttendanceEvent, AttendanceAdjustment.new_event_id == AttendanceEvent.id)
            .where(AttendanceEvent.shop_id == shop_id)
        )
        if tech_id is not None:
            stmt = stmt.where(AttendanceEvent.tech_id == tech_id)
        if start is not None:
            stmt = stmt.where(AttendanceEvent.server_time >= start)
        if end is not None:
            stmt = stmt.where(AttendanceEvent.server_time < end)
        stmt = stmt.order_by(AttendanceEvent.server_time.desc())
        result = await self._session.execute(stmt)
        return [(row[0], row[1]) for row in result.all()]

    # ── Payroll exports ──────────────────────────────────────────────────
    async def get_export_for_window(
        self, *, shop_id: str, from_date: date_type, to_date: date_type
    ) -> PayrollExportRecord | None:
        result = await self._session.execute(
            select(PayrollExportRecord).where(
                PayrollExportRecord.shop_id == shop_id,
                PayrollExportRecord.from_date == from_date,
                PayrollExportRecord.to_date == to_date,
            )
        )
        return result.scalar_one_or_none()

    async def add_export(
        self,
        *,
        shop_id: str,
        from_date: date_type,
        to_date: date_type,
        storage_path: str,
        row_count: int,
    ) -> PayrollExportRecord:
        record = PayrollExportRecord(
            shop_id=shop_id,
            from_date=from_date,
            to_date=to_date,
            storage_path=storage_path,
            row_count=row_count,
        )
        self._session.add(record)
        await self._session.flush()
        return record

    async def list_exports(self, *, shop_id: str, limit: int = 26) -> list[PayrollExportRecord]:
        result = await self._session.execute(
            select(PayrollExportRecord)
            .where(PayrollExportRecord.shop_id == shop_id)
            .order_by(PayrollExportRecord.to_date.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    # ── Roster (read of the identity table for display names) ────────────────
    async def list_active_tech_names(self) -> dict[str, str]:
        """Map of ``tech_id -> display name`` for active technicians — the
        human-readable column in the payroll CSV. Identity is the blessed
        cross-cutting slice, so reading its table here is allowed; keeping the
        query in the repository keeps raw SQL out of the service layer."""
        result = await self._session.execute(
            select(Technician.id, Technician.name).where(Technician.active.is_(True))
        )
        return {row.id: row.name for row in result}
