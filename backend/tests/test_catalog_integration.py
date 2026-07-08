"""Integration: appliance category dual-write at job intake.

Real Postgres. The conftest session fixture seeds the categories (create_all
skips migration seeds), so the category_id FK is satisfiable.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.models import Job

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
