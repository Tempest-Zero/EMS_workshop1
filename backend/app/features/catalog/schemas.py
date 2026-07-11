"""Pydantic read models for the catalog slice's HTTP surface.

Read-only: the catalog is seeded/curated via migrations and manager review;
this surface exists so the technician app's pickers (appliance category,
brand, fault/action chips, parts) render the same vocabulary the analytics
run on — ids are the C1 slugs/UUIDs the completion form writes back.
"""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name_en: str | None = None
    name_ur: str | None = None
    icon: str | None = None
    sort: int


class BrandOut(BaseModel):
    """Canonical brand + its known alias spellings (the phone matches free
    text against both, then stores the canonical name)."""

    id: UUID
    name: str
    aliases: list[str] = []


class ActionCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    category_id: str
    label_en: str | None = None
    label_ur: str | None = None
    icon: str | None = None
    sort: int


class FaultCodeOut(ActionCodeOut):
    is_surge_related: bool


class PartOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name_canonical: str
    # NULL = cross-category (capacitors, wire) — always included in filters.
    category_id: str | None = None
    quality: str | None = None
