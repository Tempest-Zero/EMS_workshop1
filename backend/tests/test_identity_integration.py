"""End-to-end identity tests against a **real Postgres**: the login flow,
the token-guarded /auth/me, and the public roster — exercising the actual SQL
and the JWT round-trip through the ASGI app.

Since 0013 this also covers the login lockout (counter persisted across
request transactions), PIN rotation (which must NOT kill sessions), and
session revocation (which must). The ``app_client`` fixture seeds the ``t1``
manager row (PIN ``1234``) those flows drive; the per-IP limiter is reset per
test in the shared conftest."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician
from app.features.identity.security import hash_pin

pytestmark = pytest.mark.integration


async def _seed_tech(session: AsyncSession, *, tech_id: str = "itech", pin: str = "1234") -> None:
    session.add(
        Technician(
            id=tech_id,
            name="Integration Tech",
            specialty="Testing",
            phone="0300-0000000",
            avatar="bg-slate-500",
            role="manager",
            pin_hash=hash_pin(pin),
            active=True,
        )
    )
    await session.commit()


async def test_login_then_me_roundtrip(app_client: AsyncClient, session: AsyncSession) -> None:
    await _seed_tech(session)

    ok = await app_client.post("/api/auth/login", json={"tech_id": "itech", "pin": "1234"})
    assert ok.status_code == 200, ok.text
    token = ok.json()["token"]
    assert ok.json()["technician"]["id"] == "itech"
    assert "pin_hash" not in ok.json()["technician"]

    me = await app_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["tech_id"] == "itech"
    assert me.json()["role"] == "manager"


async def test_login_wrong_pin_is_401(app_client: AsyncClient, session: AsyncSession) -> None:
    await _seed_tech(session)
    bad = await app_client.post("/api/auth/login", json={"tech_id": "itech", "pin": "9999"})
    assert bad.status_code == 401, bad.text


async def test_me_without_token_is_401(app_client: AsyncClient) -> None:
    resp = await app_client.get("/api/auth/me")
    assert resp.status_code == 401, resp.text


async def test_roster_lists_active_without_pins(
    app_client: AsyncClient, session: AsyncSession
) -> None:
    await _seed_tech(session)
    resp = await app_client.get("/api/technicians")
    assert resp.status_code == 200, resp.text
    ids = {t["id"] for t in resp.json()}
    assert "itech" in ids
    assert all("pin_hash" not in t for t in resp.json())


# ── Lockout / PIN rotation / revocation (0013) ───────────────────────────────
Headers = dict[str, str]


async def test_five_failures_lock_the_account_even_for_the_right_pin(
    app_client: AsyncClient,
) -> None:
    # Five separate requests, each its own transaction — this also proves the
    # counter is committed before the 401 (otherwise it could never reach 5).
    for _ in range(5):
        bad = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "0000"})
        assert bad.status_code == 401, bad.text

    locked = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert locked.status_code == 429, locked.text
    assert int(locked.headers["Retry-After"]) >= 1


async def test_set_pin_rotates_the_credential_without_killing_sessions(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    # Manager t1 sets their own PIN; manager policy wants 6+ digits.
    too_short = await app_client.put(
        "/api/technicians/t1/pin", json={"pin": "4321"}, headers=auth_headers
    )
    assert too_short.status_code == 422, too_short.text

    ok = await app_client.put(
        "/api/technicians/t1/pin", json={"pin": "987654"}, headers=auth_headers
    )
    assert ok.status_code == 204, ok.text

    # Old PIN dead, new PIN live.
    old = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert old.status_code == 401, old.text
    new = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "987654"})
    assert new.status_code == 200, new.text

    # The pre-rotation token still works — PIN change must NOT revoke sessions
    # (the installed APK's outbox drops queued writes on 401).
    me = await app_client.get("/api/auth/me", headers=auth_headers)
    assert me.status_code == 200, me.text


async def test_revoke_sessions_kills_live_tokens(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    # Mint a real token via login (carries ver=0).
    minted = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert minted.status_code == 200, minted.text
    live = {"Authorization": f"Bearer {minted.json()['token']}"}
    assert (await app_client.get("/api/auth/me", headers=live)).status_code == 200

    revoked = await app_client.post("/api/technicians/t1/revoke-sessions", headers=auth_headers)
    assert revoked.status_code == 204, revoked.text

    # Both the minted token and the fixture token die (same account).
    assert (await app_client.get("/api/auth/me", headers=live)).status_code == 401
    assert (await app_client.get("/api/auth/me", headers=auth_headers)).status_code == 401

    # A fresh login works and its token carries the bumped version.
    fresh = await app_client.post("/api/auth/login", json={"tech_id": "t1", "pin": "1234"})
    assert fresh.status_code == 200, fresh.text
    new_live = {"Authorization": f"Bearer {fresh.json()['token']}"}
    me = await app_client.get("/api/auth/me", headers=new_live)
    assert me.status_code == 200, me.text


async def test_tech_cannot_set_anothers_pin_or_revoke(
    app_client: AsyncClient, session: AsyncSession
) -> None:
    # Seed a plain tech and log in as them.
    session.add(
        Technician(
            id="t9",
            name="Plain Tech",
            role="tech",
            pin_hash=hash_pin("1234"),
            active=True,
        )
    )
    await session.commit()
    login = await app_client.post("/api/auth/login", json={"tech_id": "t9", "pin": "1234"})
    assert login.status_code == 200, login.text
    tech_headers = {"Authorization": f"Bearer {login.json()['token']}"}

    # A tech may not set someone else's PIN…
    other = await app_client.put(
        "/api/technicians/t1/pin", json={"pin": "5555"}, headers=tech_headers
    )
    assert other.status_code == 403, other.text
    # …but may rotate their own (tech policy: 4+ digits).
    own = await app_client.put(
        "/api/technicians/t9/pin", json={"pin": "5555"}, headers=tech_headers
    )
    assert own.status_code == 204, own.text

    # And revocation is manager-only.
    revoke = await app_client.post("/api/technicians/t1/revoke-sessions", headers=tech_headers)
    assert revoke.status_code == 403, revoke.text
