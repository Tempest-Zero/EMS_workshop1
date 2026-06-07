"""Pydantic request/response models for the jobs slice (snake_case, like the
other slices; the web client maps to its view shape)."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

JobStatus = Literal["open", "waiting", "ready", "closed"]
JobType = Literal["carry-in", "home-visit"]

DEFAULT_SHOP_ID = "default"


class JobCreate(BaseModel):
    """Intake form. A new job always starts ``open``; ``token`` is assigned by
    the server."""

    job_type: JobType = "carry-in"
    customer_name: str = Field(..., min_length=1, max_length=128)
    customer_phone: str | None = Field(default=None, max_length=32)
    customer_address: str | None = Field(default=None, max_length=256)
    appliance_type: str = Field(..., min_length=1, max_length=64)
    appliance_brand: str | None = Field(default=None, max_length=64)
    appliance_model: str | None = Field(default=None, max_length=64)
    problem: str = Field(default="", max_length=2048)
    assigned_tech_id: str | None = Field(default=None, max_length=64)
    preferred_date: date | None = None
    time_window: str | None = Field(default=None, max_length=64)
    shop_id: str = Field(default=DEFAULT_SHOP_ID, max_length=64)


class JobEventOut(BaseModel):
    """One timeline entry."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    kind: str
    text: str
    actor: str | None = None
    created_at: datetime


class NoteRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1024)


TransitionAction = Literal["ready", "close", "abandon", "reschedule", "haul"]


class TransitionRequest(BaseModel):
    """A status/lifecycle change. ``reason`` is required for ``abandon``;
    ``preferred_date``/``time_window`` for ``reschedule``."""

    action: TransitionAction
    reason: str | None = Field(default=None, max_length=256)
    preferred_date: date | None = None
    time_window: str | None = Field(default=None, max_length=64)


class Job(BaseModel):
    """Full read model of a job (built straight from the ORM row)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    token: int
    shop_id: str
    status: JobStatus
    job_type: JobType
    customer_name: str
    customer_phone: str | None = None
    customer_address: str | None = None
    appliance_type: str
    appliance_brand: str | None = None
    appliance_model: str | None = None
    problem: str
    assigned_tech_id: str | None = None
    preferred_date: date | None = None
    time_window: str | None = None
    waiting_reason: str | None = None
    waiting_since: date | None = None
    ready_since: date | None = None
    closed_at: date | None = None
    abandoned: bool
    abandon_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class JobDetail(Job):
    """A job plus its timeline (returned by the detail / mutation endpoints)."""

    events: list[JobEventOut] = []
