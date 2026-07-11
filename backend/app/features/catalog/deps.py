"""Catalog slice — dependency providers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.catalog.repository import CatalogRepository
from app.features.catalog.service import CatalogService


def get_catalog_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> CatalogService:
    return CatalogService(CatalogRepository(session))


CatalogServiceDep = Annotated[CatalogService, Depends(get_catalog_service)]
