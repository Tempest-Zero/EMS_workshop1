"""Pure unit tests: message composition, wa.me links, webhook signatures.

No DB, no network — the composition rules here ARE the customer-facing
contract (minimum-info), so they're pinned tightly.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import UTC, date, datetime
from uuid import uuid4

import pytest

from app.features.customer_messaging.service import (
    EVENT_TRIGGERS,
    NoBillError,
    compose_message,
    template_params,
    verify_webhook_signature,
    wa_chat_url,
)
from app.features.jobs.schemas import JobDetail

_NOW = datetime(2026, 7, 8, 12, 0, tzinfo=UTC)


def _job(**overrides: object) -> JobDetail:
    base: dict[str, object] = {
        "id": uuid4(),
        "token": 1052,
        "shop_id": "default",
        "status": "open",
        "job_type": "carry-in",
        "customer_name": "Bilal",
        "customer_phone": "+923001234567",
        "customer_address": "House 7, Gulshan Block 5",
        "appliance_type": "Split AC",
        "problem": "compressor trips after ten minutes",
        "abandoned": False,
        "created_at": _NOW,
        "updated_at": _NOW,
    }
    base.update(overrides)
    return JobDetail.model_validate(base)


# ── Minimum-info contract ─────────────────────────────────────────────────────
@pytest.mark.parametrize("kind", ["intake_ack", "ready"])
def test_messages_never_leak_internal_detail(kind: str) -> None:
    body = compose_message(kind, _job())
    # Never: problem text, address, tech identity. Always: the job header.
    assert "compressor" not in body
    assert "Gulshan" not in body
    assert "Job #1052 (Split AC)" in body


def test_bill_message_never_leaks_internal_detail() -> None:
    body = compose_message("bill", _job(bill_original_paisa=350000))
    assert "compressor" not in body
    assert "Gulshan" not in body
    assert "Job #1052 (Split AC)" in body


# ── Bill (charges) ────────────────────────────────────────────────────────────
def test_bill_uses_negotiated_over_original() -> None:
    body = compose_message("bill", _job(bill_original_paisa=350000, bill_negotiated_paisa=300000))
    assert "Total charges: Rs 3,000" in body
    assert "Rs 3,500" not in body


def test_bill_falls_back_to_original() -> None:
    assert "Total charges: Rs 3,500" in compose_message("bill", _job(bill_original_paisa=350000))


def test_bill_without_any_amount_raises() -> None:
    with pytest.raises(NoBillError):
        compose_message("bill", _job())


# ── Ready ─────────────────────────────────────────────────────────────────────
def test_ready_shows_balance_when_outstanding() -> None:
    body = compose_message("ready", _job(bill_original_paisa=350000, balance_paisa=150000))
    assert "ready for collection" in body
    assert "Amount due: Rs 1,500" in body


def test_ready_omits_balance_when_settled() -> None:
    body = compose_message("ready", _job(bill_original_paisa=350000, balance_paisa=0))
    assert "Amount due" not in body


def test_ready_without_bill_has_no_amount_line() -> None:
    assert "Amount due" not in compose_message("ready", _job())


# ── Intake acknowledgement ────────────────────────────────────────────────────
def test_intake_ack_mentions_scheduled_visit_for_home_visit() -> None:
    body = compose_message(
        "intake_ack",
        _job(job_type="home-visit", preferred_date=date(2026, 7, 10), time_window="2-5 PM"),
    )
    assert "registered" in body
    assert "Scheduled visit: 2026-07-10, 2-5 PM" in body


def test_intake_ack_carry_in_has_no_visit_line() -> None:
    assert "Scheduled visit" not in compose_message("intake_ack", _job())


# ── Template params (the Meta submission shape) ───────────────────────────────
def test_template_params_are_header_plus_detail() -> None:
    params = template_params("bill", _job(bill_original_paisa=100000))
    assert params == ["Job #1052 (Split AC)", "Total charges: Rs 1,000"]


# ── Click-to-chat URL ─────────────────────────────────────────────────────────
def test_wa_chat_url_strips_plus_and_encodes_text() -> None:
    url = wa_chat_url("+923001234567", "Job #1052\nRs 3,500")
    assert url.startswith("https://wa.me/923001234567?text=")
    assert "\n" not in url
    assert "Job%20%231052%0ARs%203%2C500" in url


# ── Webhook signature ─────────────────────────────────────────────────────────
def _sign(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_signature_accepts_valid() -> None:
    body = b'{"entry": []}'
    assert verify_webhook_signature("s3cret", body, _sign("s3cret", body))


def test_signature_rejects_wrong_secret() -> None:
    body = b'{"entry": []}'
    assert not verify_webhook_signature("s3cret", body, _sign("other", body))


def test_signature_rejects_tampered_body() -> None:
    assert not verify_webhook_signature("s3cret", b"tampered", _sign("s3cret", b"original"))


def test_signature_fails_closed_without_header_or_secret() -> None:
    body = b"{}"
    assert not verify_webhook_signature("s3cret", body, None)
    assert not verify_webhook_signature("s3cret", body, "md5=abc")
    assert not verify_webhook_signature("", body, _sign("", body))


# ── Trigger map (the outbox consumer's vocabulary) ────────────────────────────
def test_event_triggers_cover_the_three_automated_kinds() -> None:
    assert EVENT_TRIGGERS == {"create": "intake_ack", "complete": "bill", "ready": "ready"}
