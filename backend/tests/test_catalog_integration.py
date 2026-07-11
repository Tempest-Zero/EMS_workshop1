"""Integration: appliance category dual-write at job intake + the read-only
catalog HTTP surface (0036).

Real Postgres. The conftest session fixture seeds the categories (create_all
skips migration seeds), so the category_id FK is satisfiable.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.catalog.models import (
    ActionCode,
    ApplianceBrand,
    BrandAlias,
    FaultCode,
    Part,
)
from app.features.jobs.models import Job, JobMaterial

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def _create_job(client: AsyncClient, headers: Headers, **overrides: str) -> str:
    body = {"customer_name": "X", "appliance_type": "Split AC", "problem": "p"}
    body.update(overrides)
    resp = await client.post("/api/jobs", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return str(resp.json()["id"])


async def test_category_derived_from_appliance_type(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    job_id = await _create_job(app_client, auth_headers, appliance_type="Split AC")
    job = await session.get(Job, job_id)
    assert job is not None
    assert job.category_id == "ac"


async def test_explicit_category_wins_over_derived(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    job_id = await _create_job(
        app_client, auth_headers, appliance_type="Split AC", category_id="microwave"
    )
    job = await session.get(Job, job_id)
    assert job is not None
    assert job.category_id == "microwave"


async def test_unknown_appliance_type_leaves_category_null(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    job_id = await _create_job(app_client, auth_headers, appliance_type="Toaster")
    job = await session.get(Job, job_id)
    assert job is not None
    assert job.category_id is None


async def test_material_name_round_trips_after_rename(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    """W6: renaming the ``name`` column to ``name_raw`` is wire-transparent —
    the completion API still sends/echoes ``name`` (the ORM attribute), and the
    row lands in the renamed column."""
    job_id = await _create_job(app_client, auth_headers, appliance_type="Split AC")
    comp = await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [{"name": "Run Capacitor", "qty": 1, "unit_paisa": 60000}]},
        headers=auth_headers,
    )
    assert comp.status_code == 200, comp.text
    assert comp.json()["completion"]["materials"][0]["name"] == "Run Capacitor"

    material = (await session.execute(select(JobMaterial))).scalars().one()
    assert material.name == "Run Capacitor"  # attribute reads the name_raw column


async def test_material_resolves_to_a_part(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    """W6: a material line can carry the resolved ``part_id`` + per-line
    ``quality`` (the parts picker that writes these is a named deferral, so this
    exercises the columns directly at the ORM layer)."""
    part = Part(name_canonical="Run Capacitor", category_id="ac", quality="genuine")
    session.add(part)
    await session.flush()

    job_id = await _create_job(app_client, auth_headers, appliance_type="Split AC")
    await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [{"name": "cap", "qty": 1, "unit_paisa": 60000}]},
        headers=auth_headers,
    )
    material = (await session.execute(select(JobMaterial))).scalars().one()
    material.part_id = part.id
    material.quality = "aftermarket"
    material.source_market = "Saddar"
    await session.commit()

    refreshed = await session.get(JobMaterial, material.id)
    assert refreshed is not None
    assert refreshed.part_id == part.id
    assert refreshed.quality == "aftermarket"
    assert refreshed.source_market == "Saddar"


async def test_catalog_read_endpoints_serve_the_vocabulary(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    """The 0036 read surface: the phone's pickers fetch categories, brands
    (+aliases), fault/action chips, and parts — active rows only."""
    brand = ApplianceBrand(name_canonical="Haier")
    session.add(brand)
    await session.flush()
    session.add(BrandAlias(alias_norm="hair", brand_id=brand.id))
    session.add(FaultCode(id="ac_gas_low", category_id="ac", label_en="Gas low"))
    session.add(FaultCode(id="fridge_no_cool", category_id="refrigerator", label_en="No cooling"))
    session.add(FaultCode(id="ac_retired", category_id="ac", label_en="Old code", active=False))
    session.add(ActionCode(id="ac_gas_recharge", category_id="ac", label_en="Gas recharge"))
    session.add(Part(name_canonical="Run Capacitor", category_id=None, quality="genuine"))
    session.add(Part(name_canonical="AC PCB", category_id="ac"))
    await session.commit()

    cats = await app_client.get("/api/catalog/categories", headers=auth_headers)
    assert cats.status_code == 200, cats.text
    assert any(c["id"] == "ac" for c in cats.json())

    brands = await app_client.get("/api/catalog/brands", headers=auth_headers)
    assert brands.status_code == 200, brands.text
    haier = next(b for b in brands.json() if b["name"] == "Haier")
    assert haier["aliases"] == ["hair"]

    faults = await app_client.get("/api/catalog/fault-codes?category_id=ac", headers=auth_headers)
    ids = [f["id"] for f in faults.json()]
    assert "ac_gas_low" in ids
    assert "fridge_no_cool" not in ids  # category filter applies
    assert "ac_retired" not in ids  # retired codes stay invisible

    actions = await app_client.get("/api/catalog/action-codes", headers=auth_headers)
    assert any(a["id"] == "ac_gas_recharge" for a in actions.json())

    parts = await app_client.get("/api/catalog/parts?category_id=ac", headers=auth_headers)
    names = [p["name_canonical"] for p in parts.json()]
    assert "AC PCB" in names
    assert "Run Capacitor" in names  # cross-category (NULL) rides every filter


async def test_catalog_endpoints_require_auth(app_client: AsyncClient) -> None:
    resp = await app_client.get("/api/catalog/categories")
    assert resp.status_code == 401
