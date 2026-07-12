"""HTTP endpoints for the identity slice (mounted under ``/api``).

* ``GET  /api/technicians/roster``                — public roster for the login picker (active only).
* ``GET  /api/technicians``                       — full roster including inactive (manager only).
* ``POST /api/technicians``                       — register a new technician (manager only).
* ``PUT  /api/technicians/{id}``                  — edit, promote, or deactivate (manager only).
* ``POST /api/auth/login``                        — Username/Password → JWT (throttled per account + per IP).
* ``GET  /api/auth/me``                           — echo the verified caller (requires a token).
* ``PUT  /api/technicians/{id}/password``         — set a password (manager: anyone; tech: self).
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
    SetPasswordRequest,
    TechnicianCreate,
    TechnicianPublic,
    TechnicianUpdate,
)
from app.features.identity.service import (
    AccountLockedError,
    IdentityService,
    InvalidCredentialsError,
    NotPermittedError,
    PasswordPolicyError,
    TechnicianIdConflictError,
    TechnicianNotFoundError,
    UsernameConflictError,
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


@router.get("/technicians/roster", response_model=list[TechnicianPublic], summary="Public roster for login picker")
async def list_roster(service: ServiceDep) -> list[TechnicianPublic]:
    return await service.list_active()


@router.get("/technicians", response_model=list[TechnicianPublic], summary="Full roster (manager only)")
async def list_technicians(service: ServiceDep, _manager: CurrentManager) -> list[TechnicianPublic]:
    return await service.list_all()


@router.post(
    "/technicians",
    response_model=TechnicianPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new technician (manager only)",
)
async def create_technician(
    body: TechnicianCreate,
    service: ServiceDep,
    session: SessionDep,
    _manager: CurrentManager,
) -> TechnicianPublic:
    try:
        tech = await service.create_technician(body)
    except TechnicianIdConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except UsernameConflictError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    except PasswordPolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    await session.commit()
    return tech


@router.put(
    "/technicians/{tech_id}",
    response_model=TechnicianPublic,
    summary="Edit, promote, or deactivate a technician (manager only)",
)
async def update_technician(
    tech_id: str,
    body: TechnicianUpdate,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
    _manager: CurrentManager,
) -> TechnicianPublic:
    try:
        tech = await service.update_technician(
            actor_id=principal.tech_id, tech_id=tech_id, body=body
        )
    except TechnicianNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except NotPermittedError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    await session.commit()
    return tech


@router.post("/auth/login", response_model=LoginResponse, summary="Username/Password → token")
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
        resp = await service.login(username=body.username, password=body.password)
    except AccountLockedError as e:
        await session.commit()  # nothing changed, but keep the branch uniform
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"too many attempts — try again in {e.retry_after}s",
            headers={"Retry-After": str(e.retry_after)},
        ) from e
    except InvalidCredentialsError as e:
        await session.commit()  # persist the bumped failure counter / new lock
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid username or password") from e
    await session.commit()  # persist the counter reset
    return resp


@router.get("/auth/me", response_model=Principal, summary="The verified caller")
async def me(principal: CurrentPrincipal) -> Principal:
    return principal


@router.put(
    "/technicians/{tech_id}/password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Set a technician's password (manager: anyone; technician: own only)",
)
async def set_password(
    tech_id: str,
    body: SetPasswordRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> Response:
    try:
        await service.set_password(
            actor_id=principal.tech_id,
            actor_role=principal.role,
            tech_id=tech_id,
            password=body.password,
        )
    except NotPermittedError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    except TechnicianNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except PasswordPolicyError as e:
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
