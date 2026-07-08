"""Pydantic request/response models for the customers slice."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel

ConsentKind = Literal["given", "withdrawn"]
ConsentScope = Literal["contact", "whatsapp", "analytics"]
ConsentChannel = Literal["verbal", "form", "whatsapp"]


class ConsentRequest(BaseModel):
    """One consent fact: the F5 chip sends ``given/whatsapp/form``; a customer
    asking to stop sends ``withdrawn/whatsapp/verbal``. ``backfill`` is a
    script-only channel, deliberately not accepted over HTTP."""

    kind: ConsentKind
    scope: ConsentScope
    channel: ConsentChannel = "verbal"


class ConsentState(BaseModel):
    """The denormalized current answer to "may we?" after the write."""

    customer_id: UUID
    whatsapp_opt_in_at: datetime | None = None
    consent_contact_at: datetime | None = None
