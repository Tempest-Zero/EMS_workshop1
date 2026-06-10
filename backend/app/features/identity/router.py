"""HTTP endpoints for the identity slice (mounted under ``/api``).

* ``GET  /api/technicians``                       — public roster for the login picker (no PINs).
* ``POST /api/auth/login``                        — Name/PIN → JWT (throttled per account + per IP).
* ``GET  /api/auth/me``                           — echo the verified caller (requires a token).
* ``PUT  /api/technicians/{id}/pin``              — set a PIN (manager: anyone; tech: self).
* ``POST /api/technicians/{id}/revoke-sessions``  — invalidate all live tokens (manager only).

Commit discipline: the login service mutates throttle counters on *failure* —
the router commits **before** raising the 401/429, otherwise the counter rolls
back with the error response and the throttle silently never engages.
"""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentManager, CurrentPrincipal
from app.features.identity.repository import IdentityRepository
from app.features.identity.schemas import (
    LoginRequest,
    LoginResponse,
    Principal,
    SetPinRequest,
    TechnicianPublic,
)
from app.features.identity.service import (
    AccountLockedError,
    IdentityService,
    InvalidCredentialsError,
    NotPermittedError,
    PinPolicyError,
    TechnicianNotFoundError,
)
from app.features.identity.throttle import IpRateLimiter

router = APIRouter(tags=["identity"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_service(session: SessionDep) -> IdentityService:
    return IdentityService(IdentityRepository(session))


ServiceDep = Annotated[IdentityService, Depends(get_service)]

# Per-IP login cap (second line of defense behind the per-account DB lockout).
_ip_limiter = IpRateLimiter()


def _client_ip(request: Request) -> str:
    """The caller's IP. Railway terminates TLS at its edge and appends the real
    peer to ``X-Forwarded-For`` — the **last** entry is the one the trusted
    proxy added (leftmost values are client-claimable). Local dev has no XFF."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


@router.get("/technicians", response_model=list[TechnicianPublic], summary="Active roster")
async def list_technicians(service: ServiceDep) -> list[TechnicianPublic]:
    return await service.roster()


@router.post("/auth/login", response_model=LoginResponse, summary="Name/PIN → token")
async def login(
    body: LoginRequest, request: Request, service: ServiceDep, session: SessionDep
) -> LoginResponse:
    if not _ip_limiter.allow(_client_ip(request), time.time()):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "too many login attempts — slow down",
            headers={"Retry-After": "60"},
        )
    try:
        resp = await service.login(tech_id=body.tech_id, pin=body.pin)
    except AccountLockedError as e:
        await session.commit()  # nothing changed, but keep the branch uniform
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"too many attempts — try again in {e.retry_after}s",
            headers={"Retry-After": str(e.retry_after)},
        ) from e
    except InvalidCredentialsError as e:
        await session.commit()  # persist the bumped failure counter / new lock
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid tech id or PIN") from e
    await session.commit()  # persist the counter reset
    return resp


@router.get("/auth/me", response_model=Principal, summary="The verified caller")
async def me(principal: CurrentPrincipal) -> Principal:
    return principal


@router.put(
    "/technicians/{tech_id}/pin",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set a technician's PIN (manager: anyone; technician: own only)",
)
async def set_pin(
    tech_id: str,
    body: SetPinRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> Response:
    try:
        await service.set_pin(
            actor_id=principal.tech_id,
            actor_role=principal.role,
            tech_id=tech_id,
            pin=body.pin,
        )
    except NotPermittedError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    except TechnicianNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except PinPolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/technicians/{tech_id}/revoke-sessions",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Invalidate every live token for a technician (lost-phone kill switch)",
)
async def revoke_sessions(
    tech_id: str,
    service: ServiceDep,
    session: SessionDep,
    _manager: CurrentManager,
) -> Response:
    try:
        await service.revoke_sessions(tech_id=tech_id)
    except TechnicianNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
