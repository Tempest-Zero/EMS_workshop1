"""End-to-end attendance tests against a **real Postgres** — these exercise the
actual SQL (inserts, the timezone/date-range windows, the rollup, the adjustment
join, the unique-client_id constraint) that the mock-based unit tests cannot.

All endpoints are auth-guarded now (J0.5b), so every call passes ``auth_headers``."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician
from app.features.identity.security import create_access_token, hash_pin

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def _adjust(
    client: AsyncClient,
    tech_id: str,
    kind: str,
    when_iso: str,
    reason: str,
    headers: Headers,
) -> None:
    resp = await client.post(
        "/api/attendance/adjustments",
        json={
            "tech_id": tech_id,
            "kind": kind,
            "server_time": when_iso,
            "reason": reason,
            "manager_id": "m1",
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text


async def test_full_attendance_flow(app_client: AsyncClient, auth_headers: Headers) -> None:
    # An all-days-working shift so the assertions don't depend on the weekday.
    r = await app_client.put(
        "/api/attendance/shifts/t1",
        json={
            "start_local": "09:00:00",
            "end_local": "18:00:00",
            "working_days": "1111111",
            "grace_minutes": 10,
            "timezone": "Asia/Karachi",
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text

    # A fixed recent past day at 09:00 / 18:00 PKT (= 04:00 / 13:00 UTC).
    base = (datetime.now(UTC) - timedelta(days=2)).date()
    await _adjust(
        app_client,
        "t1",
        "clock_in",
        f"{base.isoformat()}T04:00:00Z",
        "missed clock-in",
        auth_headers,
    )
    await _adjust(
        app_client,
        "t1",
        "clock_out",
        f"{base.isoformat()}T13:00:00Z",
        "missed clock-out",
        auth_headers,
    )

    # Board → present, on time, full hours (real list_events + rollup).
    b = await app_client.get(
        f"/api/attendance/board?date={base.isoformat()}&tech_ids=t1", headers=auth_headers
    )
    assert b.status_code == 200, b.text
    row = next(x for x in b.json()["rows"] if x["tech_id"] == "t1")
    assert row["status"] == "present"
    assert row["late"] is False
    assert row["worked_minutes"] == 9 * 60

    # Monthly grid → at least that one present day (real grid SQL + month bounds).
    month = base.strftime("%Y-%m")
    g = await app_client.get(
        f"/api/attendance/grid?month={month}&tech_ids=t1", headers=auth_headers
    )
    assert g.status_code == 200, g.text
    grow = next(x for x in g.json()["rows"] if x["tech_id"] == "t1")
    assert grow["present"] >= 1

    # Per-tech detail → that day has both punches (real tech_days SQL).
    today = datetime.now(UTC).date().isoformat()
    d = await app_client.get(
        f"/api/attendance/techs/t1/days?start={month}-01&end={today}", headers=auth_headers
    )
    assert d.status_code == 200, d.text
    day = next(x for x in d.json()["days"] if x["day"] == base.isoformat())
    assert len(day["punches"]) == 2

    # Audit trail → both corrections, with reasons (real adjustment↔event join).
    adj = await app_client.get("/api/attendance/adjustments?tech_id=t1", headers=auth_headers)
    assert adj.status_code == 200, adj.text
    reasons = {a["reason"] for a in adj.json()}
    assert {"missed clock-in", "missed clock-out"} <= reasons


async def test_board_requires_auth(app_client: AsyncClient) -> None:
    # No bearer token → the manager guard rejects it.
    resp = await app_client.get("/api/attendance/board?shop_id=default")
    assert resp.status_code == 401, resp.text


async def test_tech_cannot_read_anothers_punches(
    app_client: AsyncClient, session: AsyncSession
) -> None:
    # A technician token reading a colleague's punch log → 403; the log carries
    # GPS + selfie URLs. Reading their own stays fine. The tech row is seeded
    # here (the auth dependency verifies callers against the live table);
    # "t8" is unused by the other integration suites, so it can't collide
    # with their own seeds.
    session.add(
        Technician(
            id="t8",
            name="Authz Tech",
            role="tech",
            pin_hash=hash_pin("1234"),
            active=True,
        )
    )
    await session.commit()
    tech_headers = {
        "Authorization": f"Bearer {create_access_token(tech_id='t8', role='tech', name='Authz Tech')}"
    }
    # Fixed, URL-safe datetimes (a "+00:00" offset would decode as a space).
    window = "start=2026-06-01T00:00:00Z&end=2026-06-08T00:00:00Z"
    other = await app_client.get(
        f"/api/attendance/punches?tech_id=t1&{window}", headers=tech_headers
    )
    assert other.status_code == 403, other.text
    own = await app_client.get(f"/api/attendance/punches?tech_id=t8&{window}", headers=tech_headers)
    assert own.status_code == 200, own.text


async def test_punch_is_idempotent_on_client_id(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    # Punches require auth now (J0.5b); re-sending the same client_id is a no-op.
    body = {
        "client_id": str(uuid4()),
        "tech_id": "t2",
        "kind": "clock_in",
        "lat": 24.86,
        "lng": 67.0,
        "is_mock_location": False,
    }
    first = await app_client.post("/api/attendance/punches", json=body, headers=auth_headers)
    assert first.status_code == 201, first.text
    assert first.json()["deduped"] is False

    # Re-sending the same client_id (an offline retry) must be a safe no-op.
    second = await app_client.post("/api/attendance/punches", json=body, headers=auth_headers)
    assert second.status_code == 201, second.text
    assert second.json()["deduped"] is True
    assert second.json()["event_id"] == first.json()["event_id"]


async def test_geofence_and_wifi_flagging(app_client: AsyncClient, auth_headers: Headers) -> None:
    g = await app_client.put(
        "/api/attendance/geofences",
        json={
            "name": "Workshop",
            "center_lat": 24.8600,
            "center_lng": 67.0000,
            "radius_m": 150,
            "is_active": True,
            "wifi_bssids": "AA:BB:CC:DD:EE:FF",
        },
        headers=auth_headers,
    )
    assert g.status_code == 200, g.text

    # ~1.4 km away with a usable fix → outside the fence (a fix with no
    # reported accuracy would be "uncertain", not outside); BSSID matches
    # case-insensitively.
    r = await app_client.post(
        "/api/attendance/punches",
        json={
            "client_id": str(uuid4()),
            "tech_id": "t3",
            "kind": "clock_in",
            "lat": 24.8700,
            "lng": 67.0100,
            "accuracy_m": 10.0,
            "is_mock_location": False,
            "wifi_bssid": "aa:bb:cc:dd:ee:ff",
        },
        headers=auth_headers,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["inside_geofence"] is False
    assert body["wifi_match"] is True


async def test_payroll_export_returns_rows(app_client: AsyncClient, auth_headers: Headers) -> None:
    resp = await app_client.get("/api/attendance/payroll", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {"shop_id", "from_date", "to_date", "rows"} <= set(body.keys())
    if body["rows"]:
        assert {"tech_id", "date", "status"} <= set(body["rows"][0].keys())
