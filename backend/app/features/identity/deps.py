"""The cross-slice auth dependency.

Any router that needs a logged-in caller depends on ``CurrentPrincipal``; the
identity comes from a verified JWT, never from a request param the client could
forge. This is the seam that replaces the old "trust the passed tech_id" model.

Since migration 0013 the check is signature + a one-row DB read: the token's
``ver`` claim must match the technician's ``token_version`` (bumping the row is
the lost-phone kill switch), the row must exist, and the account must be
active. FastAPI's per-request dependency cache means ``get_session`` here is
the same session the router uses — one indexed PK read on a six-row table.
A missing ``ver`` claim is treated as 0, so tokens issued before 0013 stay
valid until a deliberate bump (nobody is logged out by the deploy itself).
"""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.repository import IdentityRepository
from app.features.identity.schemas import Principal
from app.features.identity.security import decode_access_token

# auto_error=False so we can return 401 (not FastAPI's default 403) on a
# missing/blank Authorization header.
_bearer = HTTPBearer(auto_error=False)


async def get_current_principal(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from e

    tech = await IdentityRepository(session).get(str(claims["sub"]))
    # Deleted or deactivated accounts lose access immediately (previously their
    # tokens kept working for the full 30 days), and a version mismatch means
    # the sessions were revoked.
    if tech is None or not tech.active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "account is not active")
    if int(claims.get("ver", 0)) != tech.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session revoked — log in again")

    return Principal(
        tech_id=tech.id,
        # Role/name come from the live row, not the token — a role change (or a
        # rename) applies on the next request instead of at token expiry.
        role=tech.role,
        name=tech.name,
        must_change_password=tech.must_change_password,
    )


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]


async def require_manager(
    principal: Annotated[Principal, Depends(get_current_principal)],
) -> Principal:
    """Gate manager-only endpoints.

    The router-level auth already requires a valid token (any role); this adds
    the manager check on top, so a technician's token gets 403 instead of being
    able to read shop-wide data (payroll, attendance board, corrections). The
    web is manager-only; the mobile app never calls these endpoints.
    """
    if principal.role != "manager":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "manager role required")
    return principal


CurrentManager = Annotated[Principal, Depends(require_manager)]
