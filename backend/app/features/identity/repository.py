"""Data access for the `technician` table. Thin — the service owns logic."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician


class IdentityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, tech_id: str) -> Technician | None:
        return await self._session.get(Technician, tech_id)

    async def list_active(self) -> list[Technician]:
        stmt = select(Technician).where(Technician.active.is_(True)).order_by(Technician.name.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())
