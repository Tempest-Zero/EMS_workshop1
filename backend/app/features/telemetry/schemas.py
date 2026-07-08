"""Request/response models for the telemetry ingest endpoint."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class EventIn(BaseModel):
    """One product-analytics event from a client. ``client_id`` makes it
    idempotent (an offline retry is a safe no-op). PII rule: ``props`` may hold
    entity UUIDs and slugs only — never names, phones, addresses."""

    client_id: UUID
    name: str = Field(..., min_length=1, max_length=64)
    props: dict[str, Any] = Field(default_factory=dict)
    device_id: UUID | None = None
    device_time: datetime | None = None


class EventBatch(BaseModel):
    """Body for ``POST /api/events`` — up to 100 events per call (a client drains
    its analytics queue in batches this size; over 100 is a 422)."""

    events: list[EventIn] = Field(..., min_length=1, max_length=100)


class EventBatchResult(BaseModel):
    """``accepted`` = newly stored; ``duplicate`` = client_ids already seen
    (safe no-ops). The batch is a success either way — the client prunes both."""

    accepted: int
    duplicate: int
