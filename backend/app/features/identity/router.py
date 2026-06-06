"""HTTP endpoints for the identity slice (mounted under ``/api``).

* ``GET  /api/technicians``  — public roster for the login picker (no PINs).
* ``POST /api/auth/login``   — Name/PIN → JWT.
* ``GET  /api/auth/me``      — echo the verified caller (requires a token).
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentPrincipal
from app.features.identity.repository import IdentityRepository
from app.features.identity.schemas import (
    LoginRequest,
    LoginResponse,
    Principal,
    TechnicianPublic,
)
from app.features.identity.service import IdentityService, InvalidCredentialsError

router = APIRouter(tags=["identity"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_service(session: SessionDep) -> IdentityService:
    return IdentityService(IdentityRepository(session))


ServiceDep = Annotated[IdentityService, Depends(get_service)]


@router.get("/technicians", response_model=list[TechnicianPublic], summary="Active roster")
async def list_technicians(service: ServiceDep) -> list[TechnicianPublic]:
    return await service.roster()


@router.post("/auth/login", response_model=LoginResponse, summary="Name/PIN → token")
async def login(body: LoginRequest, service: ServiceDep) -> LoginResponse:
    try:
        return await service.login(tech_id=body.tech_id, pin=body.pin)
    except InvalidCredentialsError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid tech id or PIN") from e


@router.get("/auth/me", response_model=Principal, summary="The verified caller")
async def me(principal: CurrentPrincipal) -> Principal:
    return principal
