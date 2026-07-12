"""Data access for the `technician` table. Thin — the service owns logic."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician


class IdentityRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, tech_id: str) -> Technician | None:
        return await self._session.get(Technician, tech_id)

    async def get_by_username(self, username: str) -> Technician | None:
        stmt = select(Technician).where(Technician.username == username)
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_active(self) -> list[Technician]:
        stmt = select(Technician).where(Technician.active.is_(True)).order_by(Technician.name.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def list_all(self, include_inactive: bool = False) -> list[Technician]:
        stmt = select(Technician)
        if not include_inactive:
            stmt = stmt.where(Technician.active.is_(True))
        stmt = stmt.order_by(Technician.name.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def count_active_managers(self) -> int:
        stmt = select(func.count(Technician.id)).where(
            Technician.role == "manager", Technician.active.is_(True)
        )
        result = await self._session.execute(stmt)
        return result.scalar_one() or 0

    def add(self, tech: Technician) -> None:
        self._session.add(tech)

    async def flush(self) -> None:
        """Flush pending mutations (throttle counters, pin/version updates).
        The router owns the commit, as everywhere else."""
        await self._session.flush()
