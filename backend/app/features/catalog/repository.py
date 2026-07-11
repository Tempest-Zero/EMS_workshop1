"""Data access for the catalog slice's read-only HTTP surface. Thin — the
service owns shaping. Every query filters to ``active`` rows and (where the
column exists) ``status = 'active'``: pending-review entries stay invisible
to the phone's pickers until a manager approves them.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.catalog.models import (
    ActionCode,
    ApplianceBrand,
    ApplianceCategory,
    BrandAlias,
    FaultCode,
    Part,
)


class CatalogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_categories(self) -> list[ApplianceCategory]:
        stmt = (
            select(ApplianceCategory)
            .where(ApplianceCategory.active.is_(True))
            .order_by(ApplianceCategory.sort, ApplianceCategory.id)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_brands(self) -> list[ApplianceBrand]:
        stmt = (
            select(ApplianceBrand)
            .where(ApplianceBrand.active.is_(True), ApplianceBrand.status == "active")
            .order_by(ApplianceBrand.name_canonical)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def brand_aliases(self) -> dict[UUID, list[str]]:
        """All alias spellings, grouped by brand — one query, tiny table."""
        stmt = select(BrandAlias.brand_id, BrandAlias.alias_norm).order_by(BrandAlias.alias_norm)
        grouped: dict[UUID, list[str]] = {}
        for brand_id, alias in (await self._session.execute(stmt)).all():
            grouped.setdefault(brand_id, []).append(alias)
        return grouped

    async def list_fault_codes(self, category_id: str | None) -> list[FaultCode]:
        stmt = select(FaultCode).where(FaultCode.active.is_(True))
        if category_id is not None:
            stmt = stmt.where(FaultCode.category_id == category_id)
        stmt = stmt.order_by(FaultCode.category_id, FaultCode.sort, FaultCode.id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_action_codes(self, category_id: str | None) -> list[ActionCode]:
        stmt = select(ActionCode).where(ActionCode.active.is_(True))
        if category_id is not None:
            stmt = stmt.where(ActionCode.category_id == category_id)
        stmt = stmt.order_by(ActionCode.category_id, ActionCode.sort, ActionCode.id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def list_parts(self, category_id: str | None) -> list[Part]:
        stmt = select(Part).where(Part.active.is_(True), Part.status == "active")
        if category_id is not None:
            # Cross-category parts (category_id NULL: capacitors, wire) always
            # belong in a category-filtered picker.
            stmt = stmt.where((Part.category_id == category_id) | (Part.category_id.is_(None)))
        stmt = stmt.order_by(Part.name_canonical)
        return list((await self._session.execute(stmt)).scalars().all())
