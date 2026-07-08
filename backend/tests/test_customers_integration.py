"""Integration tests: customer identity + the intake phone-match writer.

Real Postgres (skipped without FIXFLOW_TEST_DATABASE_URL). Covers the matcher
(exact-one / ambiguous / none) and the live writer (a job created with a phone
that matches exactly one customer gets linked; otherwise customer_id stays NULL).
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.customers.models import ApplianceUnit, Customer, CustomerPhone
from app.features.customers.service import match_customer_by_phone
from app.features.jobs.models import Job

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def _seed_customer(
    session: AsyncSession, *, full_name: str, phone_e164: str, shop_id: str = "default"
) -> Customer:
    customer = Customer(full_name=full_name, shop_id=shop_id, source="backfill")
    session.add(customer)
    await session.flush()  # populate customer.id
    session.add(CustomerPhone(customer_id=customer.id, phone_e164=phone_e164, is_primary=True))
    await session.commit()
    return customer


async def test_match_returns_id_for_exactly_one(session: AsyncSession) -> None:
    customer = await _seed_customer(session, full_name="Ali", phone_e164="+923001234567")
    # A differently-formatted spelling of the same number still matches.
    assert await match_customer_by_phone(session, "0300-1234567", "default") == customer.id


async def test_match_is_none_when_ambiguous(session: AsyncSession) -> None:
    # Two customers sharing a number (household) → ambiguous → no match.
    await _seed_customer(session, full_name="Ali", phone_e164="+923007654321")
    await _seed_customer(session, full_name="Sara", phone_e164="+923007654321")
    assert await match_customer_by_phone(session, "03007654321", "default") is None


async def test_match_is_none_when_no_customer(session: AsyncSession) -> None:
    assert await match_customer_by_phone(session, "0300-0000000", "default") is None


async def test_job_create_links_customer_by_phone(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    customer = await _seed_customer(session, full_name="Bilal", phone_e164="+923005556666")
    resp = await app_client.post(
        "/api/jobs",
        json={
            "customer_name": "Bilal",
            "customer_phone": "0300-5556666",
            "appliance_type": "AC",
            "problem": "not cooling",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    job = await session.get(Job, resp.json()["id"])
    assert job is not None
    assert job.customer_id == customer.id


async def test_appliance_unit_links_to_customer_and_job(session: AsyncSession) -> None:
    # W4 asset layer: a unit anchors to a customer + category, and a job can
    # reference it (all three FKs + the partial serial index in one round-trip).
    customer = await _seed_customer(session, full_name="Unit Owner", phone_e164="+923218887766")
    unit = ApplianceUnit(
        customer_id=customer.id,
        category_id="refrigerator",
        brand_raw="Dawlance",
        serial_number="SN-123",
    )
    session.add(unit)
    await session.flush()
    job = Job(
        token=990001,
        customer_name="Unit Owner",
        appliance_type="Refrigerator",
        problem="test",
        appliance_unit_id=unit.id,
    )
    session.add(job)
    await session.commit()
    got = await session.get(Job, job.id)
    assert got is not None
    assert got.appliance_unit_id == unit.id


async def test_job_create_leaves_customer_id_null_when_no_match(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    resp = await app_client.post(
        "/api/jobs",
        json={
            "customer_name": "Walk-in",
            "customer_phone": "0300-9998877",
            "appliance_type": "Fridge",
            "problem": "no cooling",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    job = await session.get(Job, resp.json()["id"])
    assert job is not None
    assert job.customer_id is None
