"""End-to-end jobs tests against a **real Postgres**: the create → get → list
flow through the ASGI app, and the auth guard (jobs hold customer PII)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration

Headers = dict[str, str]

_INTAKE = {
    "job_type": "home-visit",
    "customer_name": "Yusuf Khan",
    "customer_phone": "0312-6677889",
    "customer_address": "House 31, Phase 2, DHA, Karachi",
    "appliance_type": "Split AC",
    "appliance_brand": "Gree",
    "problem": "Not cooling and water leaking from the indoor unit.",
    "assigned_tech_id": "t1",
    "time_window": "11:00 AM – 1:00 PM",
}


async def test_create_get_list_flow(app_client: AsyncClient, auth_headers: Headers) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    assert created.status_code == 201, created.text
    body = created.json()
    job_id = body["id"]
    assert body["status"] == "open"
    assert body["token"] >= 1052  # picks up after the seeded tokens
    assert body["customer_name"] == "Yusuf Khan"
    assert body["time_window"] == "11:00 AM – 1:00 PM"  # kept for a home visit

    # Detail round-trips the real row.
    got = await app_client.get(f"/api/jobs/{job_id}", headers=auth_headers)
    assert got.status_code == 200, got.text
    assert got.json()["appliance_brand"] == "Gree"

    # The open filter surfaces it.
    listed = await app_client.get("/api/jobs?status=open", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    assert any(j["id"] == job_id for j in listed.json())

    # A search term matches on customer/appliance/problem.
    found = await app_client.get("/api/jobs?q=leaking", headers=auth_headers)
    assert any(j["id"] == job_id for j in found.json())


async def test_carry_in_drops_visit_only_fields(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    resp = await app_client.post(
        "/api/jobs",
        json={
            "job_type": "carry-in",
            "customer_name": "Walk-in",
            "customer_address": "ignored",
            "appliance_type": "Microwave",
            "time_window": "ignored",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["customer_address"] is None
    assert resp.json()["time_window"] is None


async def test_get_unknown_job_is_404(app_client: AsyncClient, auth_headers: Headers) -> None:
    missing = "00000000-0000-0000-0000-000000000000"
    resp = await app_client.get(f"/api/jobs/{missing}", headers=auth_headers)
    assert resp.status_code == 404, resp.text


async def test_jobs_require_auth(app_client: AsyncClient) -> None:
    assert (await app_client.get("/api/jobs")).status_code == 401
    assert (await app_client.post("/api/jobs", json=_INTAKE)).status_code == 401
