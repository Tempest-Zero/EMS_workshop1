"""End-to-end identity tests against a **real Postgres**: the login flow,
the token-guarded /auth/me, and the public roster — exercising the actual SQL
and the JWT round-trip through the ASGI app."""

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
