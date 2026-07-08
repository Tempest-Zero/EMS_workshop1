"""End-to-end jobs tests against a **real Postgres**: the create → get → list
flow through the ASGI app, the auth guard (jobs hold customer PII), and the
guarded claim (409 instead of a silent steal)."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.catalog.models import ActionCode, FaultCode
from app.features.identity.models import Technician
from app.features.identity.security import create_access_token, hash_pin
from app.features.jobs.models import Job

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def _tech_headers(session: AsyncSession, tech_id: str) -> Headers:
    """A second authenticated identity, with its row seeded — the auth
    dependency verifies callers against the live technician table."""
    session.add(
        Technician(
            id=tech_id,
            name=f"Tech {tech_id}",
            role="tech",
            pin_hash=hash_pin("1234"),
            active=True,
        )
    )
    await session.commit()
    token = create_access_token(tech_id=tech_id, role="tech", name=f"Tech {tech_id}")
    return {"Authorization": f"Bearer {token}"}


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


async def test_sequential_creates_get_distinct_increasing_tokens(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    """Job numbers come from the ``job_token_seq`` sequence: each create draws a
    fresh, larger number — no two jobs share one (the max+1 race is gone)."""
    tokens = []
    for _ in range(3):
        resp = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
        assert resp.status_code == 201, resp.text
        tokens.append(resp.json()["token"])
    assert len(set(tokens)) == 3  # all distinct
    assert tokens == sorted(tokens)  # monotonically increasing


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


async def test_completion_persists_optional_fault_and_action_codes(
    app_client: AsyncClient, session: AsyncSession, auth_headers: Headers
) -> None:
    """W5 tap-pickers: optional vocabulary slugs persist and round-trip; a
    resubmit without them clears them (the completion is a full upsert)."""
    # Self-seed the vocabulary rows (create_all tests never see migration
    # seeds; the 'ac' category itself comes from conftest).
    await session.merge(FaultCode(id="ac_gas_low", category_id="ac"))
    await session.merge(ActionCode(id="ac_gas_recharge", category_id="ac"))
    await session.commit()

    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]

    comp = await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={
            "time_spent_mins": 30,
            "fault_code_id": "ac_gas_low",
            "action_code_id": "ac_gas_recharge",
        },
        headers=auth_headers,
    )
    assert comp.status_code == 200, comp.text
    assert comp.json()["completion"]["fault_code_id"] == "ac_gas_low"
    assert comp.json()["completion"]["action_code_id"] == "ac_gas_recharge"

    # Codes stay optional (flag-never-block): omitting them on a resubmit
    # clears them, like every other completion field.
    comp2 = await app_client.post(
        f"/api/jobs/{job_id}/completion", json={"time_spent_mins": 30}, headers=auth_headers
    )
    assert comp2.status_code == 200, comp2.text
    assert comp2.json()["completion"]["fault_code_id"] is None
    assert comp2.json()["completion"]["action_code_id"] is None


async def test_intake_power_warranty_fields_persist(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    """W9: the new intake/power/warranty fields round-trip, and the widened
    job_type CHECK accepts the new pickup-delivery type."""
    body = {
        **_INTAKE,
        "job_type": "pickup-delivery",
        "intake_channel": "whatsapp",
        "type_reason": "customer can't transport a 2-door fridge",
        "power_protection": "stabilizer",
        "suspected_surge": True,
        "in_warranty_claimed": False,
    }
    created = await app_client.post("/api/jobs", json=body, headers=auth_headers)
    assert created.status_code == 201, created.text

    job = await session.get(Job, created.json()["id"])
    assert job is not None
    assert job.job_type == "pickup-delivery"
    assert job.intake_channel == "whatsapp"
    assert job.type_reason == "customer can't transport a 2-door fridge"
    assert job.power_protection == "stabilizer"
    assert job.suspected_surge is True
    assert job.in_warranty_claimed is False


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


async def test_gps_route_and_fuel_estimate(app_client: AsyncClient, auth_headers: Headers) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job_id = created.json()["id"]

    # First pin → punch recorded, but no route yet (needs both ends).
    depart = await app_client.post(
        f"/api/jobs/{job_id}/locations",
        json={
            "kind": "depart_workshop",
            "lat": 24.8607,
            "lng": 67.0011,
            "is_mock": False,
            "client_id": "22222222-2222-2222-2222-222222222222",
        },
        headers=auth_headers,
    )
    assert depart.status_code == 200, depart.text
    assert depart.json()["route"] is None
    assert len(depart.json()["locations"]) == 1

    # Second pin → route distance + fuel estimate appear; both punches log a gps event.
    arrive = await app_client.post(
        f"/api/jobs/{job_id}/locations",
        json={
            "kind": "arrive_customer",
            "lat": 24.8615,
            "lng": 67.0099,
            "is_mock": True,
            "client_id": "33333333-3333-3333-3333-333333333333",
        },
        headers=auth_headers,
    )
    assert arrive.status_code == 200, arrive.text
    body = arrive.json()
    assert body["route"] is not None
    assert body["route"]["distance_m"] > 0
    assert body["route"]["fuel_paisa"] > 0
    assert len(body["locations"]) == 2
    assert sum(1 for e in body["events"] if e["kind"] == "gps") == 2
    # The mock-location flag round-trips for manager review.
    assert any(loc["is_mock"] for loc in body["locations"])

    # Replay the depart client_id (offline retry) → idempotent, still two pins.
    replay = await app_client.post(
        f"/api/jobs/{job_id}/locations",
        json={
            "kind": "depart_workshop",
            "lat": 24.8607,
            "lng": 67.0011,
            "client_id": "22222222-2222-2222-2222-222222222222",
        },
        headers=auth_headers,
    )
    assert len(replay.json()["locations"]) == 2


async def test_close_requires_a_closing_video(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    created = await app_client.post("/api/jobs", json=_INTAKE, headers=auth_headers)
    job = created.json()
    job_id = job["id"]
    token = str(job["token"])

    # No closing clip yet → close is blocked (Phase 3 gate).
    blocked = await app_client.post(
        f"/api/jobs/{job_id}/transition", json={"action": "close"}, headers=auth_headers
    )
    assert blocked.status_code == 400, blocked.text

    # Reserve a closing media row (pending — not yet uploaded). Media is keyed on token.
    media = await app_client.post(
        f"/api/jobs/{token}/media",
        json={"phase": "closing", "type": "video", "filename": "closing.mp4"},
        headers=auth_headers,
    )
    assert media.status_code == 201, media.text

    # Phase 4 money guard: even with the clip, a normal close also needs the
    # completion form on record (409, not the gate's 400).
    no_form = await app_client.post(
        f"/api/jobs/{job_id}/transition", json={"action": "close"}, headers=auth_headers
    )
    assert no_form.status_code == 409, no_form.text

    done = await app_client.post(
        f"/api/jobs/{job_id}/completion",
        json={"materials": [], "time_spent_mins": 30, "fuel_paisa": 0},
        headers=auth_headers,
    )
    assert done.status_code == 200, done.text

    # A pending closing row satisfies the gate (offline-tolerant).
    ok = await app_client.post(
        f"/api/jobs/{job_id}/transition", json={"action": "close"}, headers=auth_headers
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "closed"


async def test_jobs_require_auth(app_client: AsyncClient) -> None:
    assert (await app_client.get("/api/jobs")).status_code == 401
    assert (await app_client.post("/api/jobs", json=_INTAKE)).status_code == 401


# ── Guarded claim (1b) ───────────────────────────────────────────────────────
_UNASSIGNED = {**_INTAKE, "assigned_tech_id": None}


async def test_claim_then_steal_attempt_is_409(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    created = await app_client.post("/api/jobs", json=_UNASSIGNED, headers=auth_headers)
    job_id = created.json()["id"]
    t2 = await _tech_headers(session, "t2")

    # First claim wins.
    first = await app_client.post(f"/api/jobs/{job_id}/claim", headers=t2)
    assert first.status_code == 200, first.text
    assert first.json()["assigned_tech_id"] == "t2"

    # Re-claiming your OWN job is an idempotent success (offline retry)…
    again = await app_client.post(f"/api/jobs/{job_id}/claim", headers=t2)
    assert again.status_code == 200, again.text
    # …and doesn't duplicate the timeline event.
    claims = [e for e in again.json()["events"] if e["kind"] == "claim"]
    assert len(claims) == 1

    # A different tech claiming the held job is a conflict, naming the holder.
    blocked = await app_client.post(f"/api/jobs/{job_id}/claim", headers=auth_headers)
    assert blocked.status_code == 409, blocked.text
    assert "t2" in blocked.json()["detail"]

    # The holder is unchanged — no silent steal.
    detail = await app_client.get(f"/api/jobs/{job_id}", headers=auth_headers)
    assert detail.json()["assigned_tech_id"] == "t2"


async def test_claiming_a_closed_job_is_409(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    created = await app_client.post("/api/jobs", json=_UNASSIGNED, headers=auth_headers)
    job_id = created.json()["id"]
    # Abandon closes without the closing-video gate.
    closed = await app_client.post(
        f"/api/jobs/{job_id}/transition",
        json={"action": "abandon", "reason": "customer cancelled"},
        headers=auth_headers,
    )
    assert closed.status_code == 200, closed.text

    t2 = await _tech_headers(session, "t2")
    blocked = await app_client.post(f"/api/jobs/{job_id}/claim", headers=t2)
    assert blocked.status_code == 409, blocked.text


async def test_manager_assign_still_overrides_a_claim(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    created = await app_client.post("/api/jobs", json=_UNASSIGNED, headers=auth_headers)
    job_id = created.json()["id"]
    t2 = await _tech_headers(session, "t2")
    assert (await app_client.post(f"/api/jobs/{job_id}/claim", headers=t2)).status_code == 200

    # Manager reassignment stays unconditional (their prerogative).
    reassigned = await app_client.post(
        f"/api/jobs/{job_id}/assign", json={"tech_id": "t1"}, headers=auth_headers
    )
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["assigned_tech_id"] == "t1"
