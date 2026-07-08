"""Integration: appliance category dual-write at job intake.

Real Postgres. The conftest session fixture seeds the categories (create_all
skips migration seeds), so the category_id FK is satisfiable.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.catalog.models import Part
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
