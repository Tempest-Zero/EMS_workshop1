"""The cross-slice auth dependency.

Any router that needs a logged-in caller depends on ``CurrentPrincipal``; the
identity comes from a verified JWT, never from a request param the client could
forge. This is the seam that replaces the old "trust the passed tech_id" model.
"""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.features.identity.schemas import Principal
from app.features.identity.security import decode_access_token

# auto_error=False so we can return 401 (not FastAPI's default 403) on a
# missing/blank Authorization header.
_bearer = HTTPBearer(auto_error=False)


async def get_current_principal(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    try:
        claims = decode_access_token(creds.credentials)
    except jwt.PyJWTError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from e
    return Principal(
        tech_id=str(claims["sub"]),
        role=str(claims.get("role", "tech")),
        name=str(claims.get("name", "")),
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
