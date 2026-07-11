"""HTTP endpoints for the catalog slice (mounted under ``/api``).

Read-only, any-authenticated-principal: the technician app's pickers
(category tiles, brand dropdown, fault/action chips, parts) fetch their
vocabulary here. Writes stay curatorial (migrations + manager review) — the
phone never mutates the catalog through this surface.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.features.catalog.deps import CatalogServiceDep
from app.features.catalog.schemas import (
    ActionCodeOut,
    BrandOut,
    CategoryOut,
    FaultCodeOut,
    PartOut,
)
from app.features.identity.deps import CurrentPrincipal

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/categories", summary="Active appliance categories (picker order)")
async def list_categories(
    service: CatalogServiceDep, _principal: CurrentPrincipal
) -> list[CategoryOut]:
    return await service.categories()


@router.get("/brands", summary="Approved brands + alias spellings")
async def list_brands(service: CatalogServiceDep, _principal: CurrentPrincipal) -> list[BrandOut]:
    return await service.brands()


@router.get("/fault-codes", summary="Diagnosis vocabulary (W5), optionally per category")
async def list_fault_codes(
    service: CatalogServiceDep,
    _principal: CurrentPrincipal,
    category_id: str | None = None,
) -> list[FaultCodeOut]:
    return await service.fault_codes(category_id)


@router.get("/action-codes", summary="Fix vocabulary (W5), optionally per category")
async def list_action_codes(
    service: CatalogServiceDep,
    _principal: CurrentPrincipal,
    category_id: str | None = None,
) -> list[ActionCodeOut]:
    return await service.action_codes(category_id)


@router.get("/parts", summary="Approved parts (incl. cross-category), optionally per category")
async def list_parts(
    service: CatalogServiceDep,
    _principal: CurrentPrincipal,
    category_id: str | None = None,
) -> list[PartOut]:
    return await service.parts(category_id)
