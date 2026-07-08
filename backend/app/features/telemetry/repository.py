"""Data access for the telemetry slice. Thin — the service owns logic."""

from __future__ import annotations

from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.telemetry.models import AppEvent


class TelemetryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def insert_events(self, rows: list[dict[str, Any]]) -> int:
        """Bulk-insert app events, skipping any whose ``client_id`` already
        landed (overlapping batches / offline retries). ``ON CONFLICT DO
        NOTHING`` + ``RETURNING`` so the count is exactly the rows *newly*
        stored — the service derives ``duplicate`` from ``len(rows) - accepted``."""
        if not rows:
            return 0
        stmt = (
            pg_insert(AppEvent)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["client_id"])
            .returning(AppEvent.id)
        )
        result = await self._session.execute(stmt)
        accepted = len(result.scalars().all())
        await self._session.flush()
        return accepted
