"""Pydantic models for the identity slice."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = str  # "tech" | "manager" (checked at the DB; not enumerated for the client)


class TechnicianPublic(BaseModel):
    """Roster entry safe to expose pre-auth (the login picker needs it). Never
    includes ``pin_hash``."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    name: str
    specialty: str | None = None
    avatar: str | None = None
    role: str
    active: bool
    must_change_password: bool


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=8, max_length=128)


class SetPasswordRequest(BaseModel):
    """New password for an account."""

    password: str = Field(..., min_length=8, max_length=128)


class TechnicianCreate(BaseModel):
    id: str = Field(..., min_length=1, max_length=16, pattern=r"^[a-zA-Z0-9_-]+$")
    username: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    password: str = Field(..., min_length=8, max_length=128)
    role: Literal["tech", "manager"] = "tech"
    specialty: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    avatar: str | None = Field(default=None, max_length=32)


class TechnicianUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    specialty: str | None = Field(default=None, max_length=128)
    phone: str | None = Field(default=None, max_length=32)
    avatar: str | None = Field(default=None, max_length=32)
    role: Literal["tech", "manager"] | None = None
    active: bool | None = None


class LoginResponse(BaseModel):
    token: str
    technician: TechnicianPublic


class Principal(BaseModel):
    """The authenticated caller, derived from a verified JWT (not client input)."""

    tech_id: str
    role: str
    name: str
    must_change_password: bool
