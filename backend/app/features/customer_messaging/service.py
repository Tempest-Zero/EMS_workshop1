"""Customer messaging slice — business logic. The public surface other slices
(and the composition root) use.

Three concerns live here:

* **Composition** — the customer-facing message texts. Minimum-info by
  contract: job token + appliance + amount (negotiated else original) — never
  problem text, line items, technician identity, or address. No shop branding
  either: the sending WhatsApp account already identifies the shop, and the
  client's no-branding-on-bill constraint is still awaiting clarification.
  These exact strings are the drafts for the Meta template submissions.

* **Click-to-chat** — ``wa_chat_url`` builds the ``wa.me`` deep link the P1
  Send button opens (the phone owns that send; the server only witnesses it
  via the jobs timeline).

* **Cloud API** — the settings-gated Meta sender (template messages: every
  message here is business-initiated, so free-form text would be rejected
  outside the 24h service window), plus webhook signature verification and
  status bookkeeping. At-most-once per ``(job, kind)``: the row is claimed
  BEFORE the API call, so a crash mid-send leaves a visible ``pending`` row
  and can never double-send a charges message — for billing texts, a missed
  message beats a duplicate.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote
from uuid import UUID

import httpx

from app.core.config import settings
from app.features.customer_messaging.models import MESSAGE_KINDS, CustomerMessage
from app.features.customer_messaging.repository import CustomerMessageRepository
from app.features.customer_messaging.schemas import MessageKind, MessagePreview
from app.features.jobs.schemas import DEFAULT_SHOP_ID, JobDetail

# JobEvent/DispatchHandler come through the jobs *service* surface (re-exported
# there), keeping the slice contract honest: no reach into jobs.models.
from app.features.jobs.service import DispatchHandler, JobEvent, JobService
from app.shared.phone import to_e164_pk

logger = logging.getLogger(__name__)

# job_event kind → automated message kind (W7 outbox consumer trigger map).
# 'create' fires the intake acknowledgement, 'complete' the charges message
# (submit_completion is the bill_status none→generated flip), 'ready' the
# collection notice. Everything else passes through untouched.
EVENT_TRIGGERS: dict[str, str] = {
    "create": "intake_ack",
    "complete": "bill",
    "ready": "ready",
}


class NoBillError(Exception):
    """A bill message was asked for before any bill exists on the job."""


# ── Composition (minimum-info, template-shaped) ───────────────────────────────
def _fmt_rs(paisa: int) -> str:
    """Money renders in whole rupees (integer paisa in, ``Rs 1,500`` out)."""
    return f"Rs {paisa // 100:,}"


def _header(job: JobDetail) -> str:
    return f"Job #{job.token} ({job.appliance_type})"


def _payable_paisa(job: JobDetail) -> int | None:
    """Negotiated when one was agreed, else the auto-generated original —
    the same precedence the Bill card shows."""
    if job.bill_negotiated_paisa is not None:
        return job.bill_negotiated_paisa
    return job.bill_original_paisa


def _detail_line(kind: str, job: JobDetail) -> str:
    """The kind-specific second line — also template parameter {{2}}."""
    if kind == "bill":
        payable = _payable_paisa(job)
        if payable is None:
            raise NoBillError("no bill yet — submit the completion form first")
        return f"Total charges: {_fmt_rs(payable)}"
    if kind == "ready":
        if _payable_paisa(job) is not None and job.balance_paisa > 0:
            return f"Amount due: {_fmt_rs(job.balance_paisa)}"
        return ""
    # intake_ack: the scheduled visit, when one was booked.
    if job.job_type == "home-visit" and (job.preferred_date or job.time_window):
        when = ", ".join(
            part
            for part in (
                job.preferred_date.isoformat() if job.preferred_date else "",
                job.time_window or "",
            )
            if part
        )
        return f"Scheduled visit: {when}"
    return ""


def compose_message(kind: str, job: JobDetail) -> str:
    """The full customer-facing text (click-to-chat body, template fallback)."""
    detail = _detail_line(kind, job)
    if kind == "bill":
        lines = [
            _header(job),
            detail,
            "Please reply to this message to confirm, or call us with any questions.",
        ]
    elif kind == "ready":
        lines = [_header(job), "Your appliance is ready for collection.", detail]
    else:  # intake_ack
        lines = [
            "Your complaint has been registered.",
            _header(job),
            detail,
            "Please keep the job number for reference.",
        ]
    return "\n".join(line for line in lines if line)


def template_params(kind: str, job: JobDetail) -> list[str]:
    """Positional body parameters for the Meta template ({{1}}, {{2}}).

    Every kind carries exactly two: the job header and the kind-specific
    detail line (blank when there is none) — so all three templates share one
    shape, which keeps the client's template-approval surface small.
    """
    return [_header(job), _detail_line(kind, job)]


def wa_chat_url(phone_e164: str, body: str) -> str:
    """Click-to-chat URL: opens WhatsApp with the draft prefilled (the tech
    still presses send). wa.me wants the E.164 number without the ``+``."""
    return f"https://wa.me/{phone_e164.removeprefix('+')}?text={quote(body)}"


# ── Webhook signature (X-Hub-Signature-256) ───────────────────────────────────
def verify_webhook_signature(app_secret: str, raw_body: bytes, header: str | None) -> bool:
    """Constant-time check of Meta's payload signature. Fail-closed: no
    configured secret, or a missing/malformed header, verifies False."""
    if not app_secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


# ── Cloud API client ──────────────────────────────────────────────────────────
def _template_name(kind: str) -> str:
    return {
        "intake_ack": settings.whatsapp_template_intake_ack,
        "bill": settings.whatsapp_template_bill,
        "ready": settings.whatsapp_template_ready,
    }[kind]


async def _post_cloud_api(to_e164: str, template_name: str, params: list[str]) -> str:
    """POST one template message; returns Meta's message id (wamid). Raises on
    any HTTP/network failure — the caller records the row as failed."""
    url = (
        f"https://graph.facebook.com/{settings.whatsapp_api_version}"
        f"/{settings.whatsapp_phone_number_id}/messages"
    )
    payload = {
        "messaging_product": "whatsapp",
        "to": to_e164.removeprefix("+"),
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": settings.whatsapp_template_lang},
            "components": [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": p} for p in params],
                }
            ],
        },
    }
    headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        wamid: str = resp.json()["messages"][0]["id"]
        return wamid


# Webhook status progression — forward-only, so an out-of-order 'delivered'
# after 'read' can't regress the row. 'failed' is terminal and outranks all.
_STATUS_RANK = {"pending": 0, "sent": 1, "delivered": 2, "read": 3, "failed": 4, "suppressed": 5}


class MessagingService:
    def __init__(self, repo: CustomerMessageRepository) -> None:
        self._repo = repo

    def preview(
        self, job: JobDetail, *, kind: MessageKind, opt_in_at: datetime | None
    ) -> MessagePreview:
        """Everything the Send button needs (F15). Raises ``NoBillError`` for
        a bill preview before the completion form generated one."""
        body = compose_message(kind, job)
        phone = to_e164_pk(job.customer_phone)
        return MessagePreview(
            kind=kind,
            customer_id=job.customer_id,
            to_phone_e164=phone,
            consent=opt_in_at is not None,
            whatsapp_opt_in_at=opt_in_at,
            body=body,
            wa_me_url=wa_chat_url(phone, body) if phone else None,
            cloud_enabled=settings.whatsapp_cloud_enabled,
        )

    async def send_cloud_message(
        self, job: JobDetail, *, kind: str, opt_in_at: datetime | None
    ) -> tuple[CustomerMessage, bool]:
        """The idempotent automated send. Returns ``(row, sent_now)`` —
        ``sent_now`` is True only when THIS call performed a successful send.

        Exactly one decision row ever exists per (job, kind):
        * replay (row exists) → return it untouched, send nothing;
        * no consent / no addressable mobile → a permanent ``suppressed`` row
          (a late opt-in must not fire a stale bill text);
        * otherwise claim ``pending``, call Meta, mark ``sent``/``failed``.

        The claim-before-send order makes a crash observable (a stuck
        ``pending``) instead of double-sending. Send failures are recorded,
        never raised — delivery is best-effort; the money flow must not 500.
        The caller owns the commit.
        """
        if kind not in MESSAGE_KINDS:
            raise ValueError(f"unknown message kind: {kind}")
        existing = await self._repo.get_by_job_kind(job.id, kind)
        if existing is not None:
            return existing, False

        phone = to_e164_pk(job.customer_phone)
        suppress_reason = None
        if phone is None:
            suppress_reason = "no_addressable_phone"
        elif opt_in_at is None:
            suppress_reason = "no_consent"

        row = CustomerMessage(
            shop_id=job.shop_id,
            job_id=job.id,
            customer_id=job.customer_id,
            kind=kind,
            to_phone_e164=phone,
            body="" if suppress_reason else compose_message(kind, job),
            template_name=None if suppress_reason else _template_name(kind),
            status="suppressed" if suppress_reason else "pending",
            error=suppress_reason,
        )
        try:
            await self._repo.add(row)
        except Exception:
            # Lost the (job, kind) race to a concurrent dispatcher/endpoint —
            # the winner's row is the decision. Rollback clears the session.
            await self._repo.rollback()
            raced = await self._repo.get_by_job_kind(job.id, kind)
            if raced is None:
                raise
            return raced, False

        if suppress_reason:
            logger.info("whatsapp %s suppressed for job %s: %s", kind, job.token, suppress_reason)
            return row, False

        to = row.to_phone_e164
        if to is None:  # unreachable — the suppressed branch returned above
            return row, False
        try:
            wamid = await _post_cloud_api(to, row.template_name or "", template_params(kind, job))
        except Exception as exc:  # noqa: BLE001 — best-effort: record, never break the caller
            row.status = "failed"
            row.error = str(exc)[:512]
            row.updated_at = datetime.now(UTC)
            logger.warning("whatsapp %s send failed for job %s", kind, job.token, exc_info=True)
            return row, False

        row.status = "sent"
        row.provider_message_id = wamid
        row.sent_at = datetime.now(UTC)
        row.updated_at = row.sent_at
        return row, True

    async def apply_status_update(self, wamid: str, status: str, error: str | None) -> bool:
        """Fold one webhook status (sent/delivered/read/failed) into its row.
        Unknown wamids (another sender on the same number, a purged row) and
        out-of-order regressions are ignored. Returns True when a row moved."""
        if status not in _STATUS_RANK:
            return False
        row = await self._repo.get_by_provider_id(wamid)
        if row is None:
            return False
        if _STATUS_RANK[status] <= _STATUS_RANK.get(row.status, 0):
            return False
        row.status = status
        if error:
            row.error = error[:512]
        row.updated_at = datetime.now(UTC)
        return True

    async def process_webhook(self, payload: dict[str, Any]) -> tuple[int, int]:
        """Walk Meta's entry/changes envelope. Returns ``(statuses_applied,
        inbound_seen)``. Inbound customer messages are counted, never acted on
        — a customer reply is NEVER a billing mutation; timeline linking is a
        deliberate later step once the frontend defines the surface."""
        statuses_applied = 0
        inbound_seen = 0
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for st in value.get("statuses", []):
                    wamid = st.get("id")
                    status = st.get("status")
                    if not isinstance(wamid, str) or not isinstance(status, str):
                        continue
                    errors = st.get("errors") or []
                    error = None
                    if errors and isinstance(errors[0], dict):
                        error = str(errors[0].get("title") or errors[0].get("message") or "")
                    if await self.apply_status_update(wamid, status, error):
                        statuses_applied += 1
                for _msg in value.get("messages", []):
                    inbound_seen += 1
        if inbound_seen:
            logger.info("whatsapp webhook: %s inbound message(s) noted", inbound_seen)
        return statuses_applied, inbound_seen


# ── Outbox consumer (composition root wires this) ─────────────────────────────
def build_dispatch_handler(
    service: MessagingService,
    jobs_service: JobService,
    opt_in_lookup: Callable[[UUID], Awaitable[datetime | None]],
) -> DispatchHandler:
    """The real WhatsApp outbox consumer (replaces the v0 log-only handler).

    ``opt_in_lookup`` is ``async (customer_id) -> datetime | None`` — injected
    by the composition root (customers slice) so this slice stays decoupled
    from customers' internals. When the Cloud API isn't configured the handler
    degrades to the v0 behaviour: log and advance, so flipping
    ``enable_dispatcher`` on stays harmless.

    A send failure is recorded on the row (never raised), so the cursor always
    advances — the dead-letter path stays reserved for genuinely poisoned
    events (e.g. a job the event points at that no longer loads).
    """

    async def handle(event: JobEvent) -> None:
        kind = EVENT_TRIGGERS.get(event.kind)
        if kind is None:
            return
        if not settings.whatsapp_cloud_enabled:
            logger.info(
                "dispatch[whatsapp] cloud API off — would send %s for job %s (seq=%s)",
                kind,
                event.job_id,
                event.seq,
            )
            return
        job = await jobs_service.get_job(job_id=event.job_id, shop_id=DEFAULT_SHOP_ID)
        opt_in_at = await opt_in_lookup(job.customer_id) if job.customer_id else None
        await service.send_cloud_message(job, kind=kind, opt_in_at=opt_in_at)

    return handle
