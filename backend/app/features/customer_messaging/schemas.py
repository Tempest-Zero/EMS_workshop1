"""Pydantic request/response models for the customer_messaging slice."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

# Mirrors models.MESSAGE_KINDS — the wire-side spelling of the one constant.
MessageKind = Literal["intake_ack", "bill", "ready"]


class MessagePreview(BaseModel):
    """Everything the Send button needs to decide and act: the composed text,
    the one-tap click-to-chat URL, and the consent/addressability facts the
    annex says to check (no consent → SMS/share sheet fallback)."""

    kind: MessageKind
    customer_id: UUID | None = None
    to_phone_e164: str | None = None
    consent: bool = False
    whatsapp_opt_in_at: datetime | None = None
    body: str
    # None when the job's phone isn't an addressable mobile.
    wa_me_url: str | None = None
    # True when POST …/send would actually reach the Cloud API.
    cloud_enabled: bool = False


class SendRequest(BaseModel):
    kind: MessageKind = "bill"


class MessageOut(BaseModel):
    """One ``customer_message`` row — the Cloud sender's bookkeeping."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: UUID
    kind: str
    status: str
    to_phone_e164: str | None = None
    body: str
    template_name: str | None = None
    provider_message_id: str | None = None
    error: str | None = None
    created_at: datetime
    sent_at: datetime | None = None


class WebhookResult(BaseModel):
    """Ack payload for Meta's webhook POST (2xx = don't retry)."""

    statuses_applied: int = 0
    inbound_seen: int = 0
