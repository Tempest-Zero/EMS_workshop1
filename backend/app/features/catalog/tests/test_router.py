"""Router-level tests for the catalog slice. Service + auth are overridden
with fakes so no DB round-trip happens (mirrors the other slices)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.features.catalog.deps import get_catalog_service
from app.features.catalog.schemas import BrandOut, CategoryOut, FaultCodeOut
from app.features.catalog.service import CatalogService
from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.main import app

_FAKE_PRINCIPAL = Principal(tech_id="t1", role="tech", name="Test Tech")


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=CatalogService)


@pytest_asyncio.fixture
async def client(fake_service: AsyncMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_catalog_service] = lambda: cast(CatalogService, fake_service)
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_categories_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.categories.return_value = [
        CategoryOut(id="ac", name_en="Air Conditioner", name_ur=None, icon=None, sort=0)
    ]
    resp = await client.get("/api/catalog/categories")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "ac"


async def test_brands_include_aliases(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.brands.return_value = [
        BrandOut(id=uuid4(), name="Haier", aliases=["hair", "haeir"])
    ]
    resp = await client.get("/api/catalog/brands")
    assert resp.status_code == 200
    body = resp.json()
    assert body[0]["name"] == "Haier"
    assert body[0]["aliases"] == ["hair", "haeir"]


async def test_fault_codes_pass_category_filter(
    client: AsyncClient, fake_service: AsyncMock
) -> None:
    fake_service.fault_codes.return_value = [
        FaultCodeOut(
            id="ac_gas_low",
            category_id="ac",
            label_en="Gas low",
            label_ur=None,
            icon=None,
            sort=0,
            is_surge_related=False,
        )
    ]
    resp = await client.get("/api/catalog/fault-codes?category_id=ac")
    assert resp.status_code == 200
    assert resp.json()[0]["id"] == "ac_gas_low"
    fake_service.fault_codes.assert_awaited_once_with("ac")


async def test_action_codes_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.action_codes.return_value = []
    resp = await client.get("/api/catalog/action-codes")
    assert resp.status_code == 200
    assert resp.json() == []
    fake_service.action_codes.assert_awaited_once_with(None)


async def test_parts_returns_200(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.parts.return_value = []
    resp = await client.get("/api/catalog/parts?category_id=refrigerator")
    assert resp.status_code == 200
    fake_service.parts.assert_awaited_once_with("refrigerator")


async def test_catalog_requires_auth(fake_service: AsyncMock) -> None:
    """No principal override → the real dependency rejects the tokenless call."""
    app.dependency_overrides[get_catalog_service] = lambda: cast(CatalogService, fake_service)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            resp = await c.get("/api/catalog/categories")
        assert resp.status_code == 401
    finally:
        app.dependency_overrides.clear()
