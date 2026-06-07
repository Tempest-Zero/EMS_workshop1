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


async def test_lifecycle_note_and_transition(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]

    # Add a note → it lands on the timeline with the actor.
    noted = await app_client.post(
        f"/api/jobs/{job_id}/notes", json={"text": "gas low, capacitor weak"}, headers=auth_headers
    )
    assert noted.status_code == 201, noted.text
    events = noted.json()["events"]
    assert any(e["kind"] == "note" and "gas low" in e["text"] for e in events)
    assert any(e["kind"] == "create" for e in events)  # seeded on create

    # Mark ready → status + ready_since update, and a 'ready' event appends.
    ready = await app_client.post(
        f"/api/jobs/{job_id}/transition", json={"action": "ready"}, headers=auth_headers
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["status"] == "ready"
    assert ready.json()["ready_since"] is not None
    assert any(e["kind"] == "ready" for e in ready.json()["events"])

    # The detail endpoint now returns the full timeline.
    detail = await app_client.get(f"/api/jobs/{job_id}", headers=auth_headers)
    kinds = [e["kind"] for e in detail.json()["events"]]
    assert {"create", "note", "ready"} <= set(kinds)
    assert kinds[0] == "create"  # oldest first


async def test_abandon_requires_reason(app_client: AsyncClient, auth_headers: Headers) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]
    bad = await app_client.post(
        f"/api/jobs/{job_id}/transition", json={"action": "abandon"}, headers=auth_headers
    )
    assert bad.status_code == 400, bad.text

    ok = await app_client.post(
        f"/api/jobs/{job_id}/transition",
        json={"action": "abandon", "reason": "irreparable"},
        headers=auth_headers,
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["abandoned"] is True
    assert ok.json()["status"] == "closed"


async def test_completion_generates_bill_then_negotiate(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]

    # Completion form → original bill (integer paisa): 120000 materials +
    # 120000 labour (1h @ Rs1200) + 50000 fuel = 290000.
    comp = await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={
            "materials": [{"name": "Run capacitor", "qty": 2, "unit_paisa": 60000}],
            "time_spent_mins": 60,
            "fuel_paisa": 50000,
            "remarks_text": "Replaced capacitor + topped gas",
        },
        headers=auth_headers,
    )
    assert comp.status_code == 200, comp.text
    body = comp.json()
    assert body["bill_original_paisa"] == 290000
    assert body["bill_status"] == "generated"
    assert body["completion"]["materials"][0]["name"] == "Run capacitor"
    assert any(e["kind"] == "complete" for e in body["events"])

    # Re-submit (upsert) replaces materials + regenerates the bill.
    comp2 = await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [{"name": "Compressor", "qty": 1, "unit_paisa": 800000}]},
        headers=auth_headers,
    )
    assert comp2.json()["bill_original_paisa"] == 800000
    assert len(comp2.json()["completion"]["materials"]) == 1  # replaced, not appended

    # Negotiate → original kept, negotiated stored separately.
    neg = await app_client.post(
        f"/api/jobs/{job_id}/bill/negotiate",
        json={"amount_paisa": 700000, "note": "regular customer"},
        headers=auth_headers,
    )
    assert neg.status_code == 200, neg.text
    assert neg.json()["bill_original_paisa"] == 800000
    assert neg.json()["bill_negotiated_paisa"] == 700000
    assert neg.json()["bill_status"] == "negotiated"


async def test_negotiate_without_completion_is_400(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]
    resp = await app_client.post(
        f"/api/jobs/{job_id}/bill/negotiate", json={"amount_paisa": 1000}, headers=auth_headers
    )
    assert resp.status_code == 400, resp.text


async def test_payment_ledger_dedup_and_void(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]
    # Generate a Rs 5000 bill.
    await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [{"name": "Compressor", "qty": 1, "unit_paisa": 500000}]},
        headers=auth_headers,
    )

    cid = "11111111-1111-1111-1111-111111111111"
    p1 = await app_client.post(
        f"/api/jobs/{job_id}/payments",
        json={"amount_paisa": 200000, "method": "cash", "client_id": cid},
        headers=auth_headers,
    )
    assert p1.status_code == 200, p1.text
    assert p1.json()["received_paisa"] == 200000
    assert p1.json()["balance_paisa"] == 300000  # 500000 − 200000

    # Replay the same client_id (offline retry) → idempotent, no double-charge.
    p2 = await app_client.post(
        f"/api/jobs/{job_id}/payments",
        json={"amount_paisa": 200000, "method": "cash", "client_id": cid},
        headers=auth_headers,
    )
    assert p2.json()["received_paisa"] == 200000
    assert len(p2.json()["payments"]) == 1

    # Void it → received back to 0, but the row is kept (audit trail).
    payment_id = p2.json()["payments"][0]["id"]
    voided = await app_client.post(
        f"/api/jobs/{job_id}/payments/{payment_id}/void",
        json={"reason": "wrong amount"},
        headers=auth_headers,
    )
    assert voided.status_code == 200, voided.text
    assert voided.json()["received_paisa"] == 0
    assert voided.json()["payments"][0]["voided"] is True


async def test_jobs_require_auth(app_client: AsyncClient) -> None:
    assert (await app_client.get("/api/jobs")).status_code == 401
    assert (await app_client.post("/api/jobs", json=_INTAKE)).status_code == 401
