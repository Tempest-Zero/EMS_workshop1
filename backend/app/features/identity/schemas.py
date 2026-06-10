"""Pydantic models for the identity slice."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

Role = str  # "tech" | "manager" (checked at the DB; not enumerated for the client)


class TechnicianPublic(BaseModel):
    """Roster entry safe to expose pre-auth (the login picker needs it). Never
    includes ``pin_hash``."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    specialty: str | None = None
    avatar: str | None = None
    role: str
    active: bool


class LoginRequest(BaseModel):
    tech_id: str = Field(..., min_length=1, max_length=64)
    pin: str = Field(..., min_length=3, max_length=12)


class SetPinRequest(BaseModel):
    """New PIN for an account. The digit/length policy lives in the service —
    the minimum depends on the *target's* role (managers need 6+)."""

    pin: str = Field(..., min_length=4, max_length=12)


class LoginResponse(BaseModel):
    token: str
    technician: TechnicianPublic


class Principal(BaseModel):
    """The authenticated caller, derived from a verified JWT (not client input)."""

    tech_id: str
    role: str
    name: str
