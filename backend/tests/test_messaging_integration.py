"""Integration tests: consent writes, the WhatsApp messaging surface, and the
outbox consumer's double-send guard.

Real Postgres (skipped without FIXFLOW_TEST_DATABASE_URL). The Cloud API
itself is always faked (``_post_cloud_api`` monkeypatched) — these tests prove
the *bookkeeping*: consent gating, (job, kind) idempotency, webhook status
folding, and the click-to-chat timeline write.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.features.customer_messaging.deps import get_messaging_service
from app.features.customer_messaging.models import CustomerMessage
from app.features.customer_messaging.service import build_dispatch_handler
from app.features.customers.models import Customer, CustomerConsentEvent, CustomerPhone
from app.features.customers.service import get_whatsapp_opt_in
from app.features.jobs.deps import get_jobs_service
from app.features.jobs.models import Job
from app.features.jobs.service import run_dispatch_once

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def _seed_customer(session: AsyncSession, *, full_name: str, phone_e164: str) -> Customer:
    customer = Customer(full_name=full_name, shop_id="default", source="backfill")
    session.add(customer)
    await session.flush()
    session.add(CustomerPhone(customer_id=customer.id, phone_e164=phone_e164, is_primary=True))
    await session.commit()
    return customer


async def _create_job(
    app_client: AsyncClient,
    auth_headers: Headers,
    *,
    phone: str = "0300-1234567",
    consent: bool = False,
) -> dict[str, Any]:
    resp = await app_client.post(
        "/api/jobs",
        json={
            "customer_name": "Bilal",
            "customer_phone": phone,
            "appliance_type": "Split AC",
            "problem": "not cooling",
            "whatsapp_consent": consent,
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


def _enable_cloud(monkeypatch: pytest.MonkeyPatch) -> list[list[Any]]:
    """Configure the Cloud API + capture calls instead of hitting Meta."""
    monkeypatch.setattr(settings, "whatsapp_access_token", "test-token")
    monkeypatch.setattr(settings, "whatsapp_phone_number_id", "1234567890")
    calls: list[list[Any]] = []

    async def _fake_post(to: str, template: str, params: list[str]) -> str:
        calls.append([to, template, params])
        return f"wamid.test{len(calls)}"

    monkeypatch.setattr("app.features.customer_messaging.service._post_cloud_api", _fake_post)
    return calls


# ── Consent endpoint ──────────────────────────────────────────────────────────
async def test_consent_given_then_withdrawn(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    customer = await _seed_customer(session, full_name="Ali", phone_e164="+923009998877")
    resp = await app_client.post(
        f"/api/customers/{customer.id}/consent",
        json={"kind": "given", "scope": "whatsapp", "channel": "verbal"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["whatsapp_opt_in_at"] is not None

    resp = await app_client.post(
        f"/api/customers/{customer.id}/consent",
        json={"kind": "withdrawn", "scope": "whatsapp", "channel": "verbal"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["whatsapp_opt_in_at"] is None

    # Both facts landed in the append-only log.
    kinds = (
        (
            await session.execute(
                select(CustomerConsentEvent.kind).where(
                    CustomerConsentEvent.customer_id == customer.id
                )
            )
        )
        .scalars()
        .all()
    )
    assert sorted(kinds) == ["given", "withdrawn"]


async def test_consent_unknown_customer_is_404(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    resp = await app_client.post(
        "/api/customers/00000000-0000-0000-0000-000000000000/consent",
        json={"kind": "given", "scope": "whatsapp", "channel": "verbal"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── Consent at intake (the F5 chip) ───────────────────────────────────────────
async def test_intake_consent_creates_and_links_customer(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    job = await _create_job(app_client, auth_headers, phone="0300-5551122", consent=True)
    row = await session.get(Job, job["id"])
    assert row is not None
    assert row.customer_id is not None
    customer = await session.get(Customer, row.customer_id)
    assert customer is not None
    assert customer.whatsapp_opt_in_at is not None
    phones = (
        (
            await session.execute(
                select(CustomerPhone.phone_e164).where(CustomerPhone.customer_id == customer.id)
            )
        )
        .scalars()
        .all()
    )
    assert phones == ["+923005551122"]


async def test_intake_consent_links_existing_customer(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    existing = await _seed_customer(session, full_name="Bilal", phone_e164="+923004443322")
    job = await _create_job(app_client, auth_headers, phone="0300-4443322", consent=True)
    row = await session.get(Job, job["id"])
    assert row is not None
    assert row.customer_id == existing.id
    assert await get_whatsapp_opt_in(session, existing.id) is not None


async def test_intake_consent_without_mobile_degrades_gracefully(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    # A landline can't receive WhatsApp: no customer is invented for it.
    job = await _create_job(app_client, auth_headers, phone="021-34567890", consent=True)
    row = await session.get(Job, job["id"])
    assert row is not None
    assert row.customer_id is None
    assert (await session.execute(select(func.count(Customer.id)))).scalar() == 0


# ── Preview (the Send button's input) ─────────────────────────────────────────
async def test_preview_intake_ack_builds_wa_link(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    job = await _create_job(app_client, auth_headers)
    resp = await app_client.get(
        f"/api/messaging/jobs/{job['id']}/whatsapp/preview",
        params={"kind": "intake_ack"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["consent"] is False  # no chip at intake
    assert data["cloud_enabled"] is False
    assert data["wa_me_url"].startswith("https://wa.me/923001234567?text=")
    assert f"Job #{job['token']}" in data["body"]
    assert "not cooling" not in data["body"]  # minimum-info: never the problem


async def test_preview_bill_is_409_before_a_bill_exists(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    job = await _create_job(app_client, auth_headers)
    resp = await app_client.get(
        f"/api/messaging/jobs/{job['id']}/whatsapp/preview",
        params={"kind": "bill"},
        headers=auth_headers,
    )
    assert resp.status_code == 409


# ── Click-to-chat send-log (F15) ──────────────────────────────────────────────
async def test_send_log_lands_on_the_job_timeline(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    job = await _create_job(app_client, auth_headers)
    resp = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send-log",
        json={"kind": "bill"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    bill_events = [e for e in resp.json()["events"] if e["kind"] == "bill"]
    assert len(bill_events) == 1
    assert "WhatsApp" in bill_events[0]["text"]
    assert "click-to-chat" in bill_events[0]["text"]


# ── Cloud send endpoint ───────────────────────────────────────────────────────
async def test_send_is_503_until_configured(app_client: AsyncClient, auth_headers: Headers) -> None:
    job = await _create_job(app_client, auth_headers)
    resp = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send",
        json={"kind": "intake_ack"},
        headers=auth_headers,
    )
    assert resp.status_code == 503


async def test_cloud_send_is_idempotent_per_job_and_kind(
    app_client: AsyncClient,
    auth_headers: Headers,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _enable_cloud(monkeypatch)
    job = await _create_job(app_client, auth_headers, consent=True)

    first = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send",
        json={"kind": "intake_ack"},
        headers=auth_headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "sent"
    assert first.json()["provider_message_id"] == "wamid.test1"
    # The fake intercepts _post_cloud_api itself, so it sees canonical E.164;
    # the '+' strip Meta wants happens inside the real payload construction
    # (covered by the wa_chat_url unit test for the same rule).
    assert calls[0][0] == "+923001234567"

    replay = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send",
        json={"kind": "intake_ack"},
        headers=auth_headers,
    )
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
    assert len(calls) == 1  # the API was hit exactly once

    count = (
        await session.execute(
            select(func.count(CustomerMessage.id)).where(CustomerMessage.job_id == UUID(job["id"]))
        )
    ).scalar()
    assert count == 1


async def test_cloud_send_suppressed_without_consent(
    app_client: AsyncClient,
    auth_headers: Headers,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _enable_cloud(monkeypatch)
    job = await _create_job(app_client, auth_headers, consent=False)
    resp = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send",
        json={"kind": "intake_ack"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "suppressed"
    assert resp.json()["error"] == "no_consent"
    assert calls == []  # nothing left the building


# ── Webhooks ──────────────────────────────────────────────────────────────────
def _signed_headers(secret: str, raw: bytes) -> Headers:
    sig = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return {"Content-Type": "application/json", "X-Hub-Signature-256": sig}


async def test_webhook_get_handshake(
    app_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "whatsapp_webhook_verify_token", "verify-me")
    ok = await app_client.get(
        "/api/webhooks/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "verify-me",
            "hub.challenge": "12345",
        },
    )
    assert ok.status_code == 200
    assert ok.text == "12345"

    bad = await app_client.get(
        "/api/webhooks/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": "wrong",
            "hub.challenge": "12345",
        },
    )
    assert bad.status_code == 403


async def test_webhook_get_fails_closed_when_unconfigured(app_client: AsyncClient) -> None:
    resp = await app_client.get(
        "/api/webhooks/whatsapp",
        params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "x"},
    )
    assert resp.status_code == 403


async def test_webhook_post_folds_status_updates(
    app_client: AsyncClient,
    auth_headers: Headers,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "whatsapp_app_secret", "hook-secret")
    calls = _enable_cloud(monkeypatch)
    job = await _create_job(app_client, auth_headers, consent=True)
    sent = await app_client.post(
        f"/api/messaging/jobs/{job['id']}/whatsapp/send",
        json={"kind": "intake_ack"},
        headers=auth_headers,
    )
    wamid = sent.json()["provider_message_id"]
    assert len(calls) == 1

    payload = {
        "entry": [{"changes": [{"value": {"statuses": [{"id": wamid, "status": "delivered"}]}}]}]
    }
    raw = json.dumps(payload).encode()
    resp = await app_client.post(
        "/api/webhooks/whatsapp", content=raw, headers=_signed_headers("hook-secret", raw)
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["statuses_applied"] == 1

    row = (
        await session.execute(
            select(CustomerMessage).where(CustomerMessage.provider_message_id == wamid)
        )
    ).scalar_one()
    assert row.status == "delivered"


async def test_webhook_post_rejects_bad_signature(
    app_client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "whatsapp_app_secret", "hook-secret")
    raw = b'{"entry": []}'
    resp = await app_client.post(
        "/api/webhooks/whatsapp", content=raw, headers=_signed_headers("wrong-secret", raw)
    )
    assert resp.status_code == 403


async def test_webhook_post_fails_closed_without_secret(app_client: AsyncClient) -> None:
    raw = b'{"entry": []}'
    resp = await app_client.post(
        "/api/webhooks/whatsapp", content=raw, headers=_signed_headers("anything", raw)
    )
    assert resp.status_code == 403


# ── The outbox consumer: completion replays can't double-send ─────────────────
async def test_dispatch_sends_bill_once_across_completion_replays(
    app_client: AsyncClient,
    auth_headers: Headers,
    session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _enable_cloud(monkeypatch)
    job = await _create_job(app_client, auth_headers, consent=True)

    completion = {"materials": [], "time_spent_mins": 60, "fuel_paisa": 0}
    resp = await app_client.post(
        f"/api/jobs/{job['id']}/completion", json=completion, headers=auth_headers
    )
    assert resp.status_code == 200, resp.text

    async def _opt_in(customer_id: UUID) -> datetime | None:
        return await get_whatsapp_opt_in(session, customer_id)

    handler = build_dispatch_handler(
        get_messaging_service(session), get_jobs_service(session), _opt_in
    )
    await run_dispatch_once(session, "whatsapp", handler)
    # The 'create' event fired the intake ack, 'complete' the bill.
    assert len(calls) == 2
    assert {c[1] for c in calls} == {"fixflow_intake_ack", "fixflow_bill"}

    # Replay: the mobile outbox resubmits the completion (idempotent upsert) —
    # a fresh 'complete' event lands, but the bill message must NOT re-send.
    resp = await app_client.post(
        f"/api/jobs/{job['id']}/completion", json=completion, headers=auth_headers
    )
    assert resp.status_code == 200
    await run_dispatch_once(session, "whatsapp", handler)
    assert len(calls) == 2

    per_kind = (
        await session.execute(
            select(CustomerMessage.kind, func.count())
            .where(CustomerMessage.job_id == UUID(job["id"]))
            .group_by(CustomerMessage.kind)
        )
    ).all()
    assert dict(per_kind) == {"intake_ack": 1, "bill": 1}
