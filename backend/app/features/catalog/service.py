"""Catalog slice — read-only vocabulary lookups for the pickers.

The completion form writes ``fault_code_id``/``action_code_id`` slugs and the
intake form writes canonical brand names; this service is where the phone
gets those vocabularies from. No writes: new brands/models a technician types
still arrive as free text on the job (C7 raw+resolved) and are curated into
the catalog by a manager, not by this surface.
"""

from __future__ import annotations

from app.features.catalog.repository import CatalogRepository
from app.features.catalog.schemas import (
    ActionCodeOut,
    BrandOut,
    CategoryOut,
    FaultCodeOut,
    PartOut,
)


class CatalogService:
    def __init__(self, repo: CatalogRepository) -> None:
        self._repo = repo

    async def categories(self) -> list[CategoryOut]:
        return [CategoryOut.model_validate(c) for c in await self._repo.list_categories()]

    async def brands(self) -> list[BrandOut]:
        aliases = await self._repo.brand_aliases()
        return [
            BrandOut(id=b.id, name=b.name_canonical, aliases=aliases.get(b.id, []))
            for b in await self._repo.list_brands()
        ]

    async def fault_codes(self, category_id: str | None = None) -> list[FaultCodeOut]:
        return [
            FaultCodeOut.model_validate(c) for c in await self._repo.list_fault_codes(category_id)
        ]

    async def action_codes(self, category_id: str | None = None) -> list[ActionCodeOut]:
        return [
            ActionCodeOut.model_validate(c) for c in await self._repo.list_action_codes(category_id)
        ]

    async def parts(self, category_id: str | None = None) -> list[PartOut]:
        return [PartOut.model_validate(p) for p in await self._repo.list_parts(category_id)]
