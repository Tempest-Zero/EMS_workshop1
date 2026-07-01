"""Dependency wiring + auth for the ops slice.

Two things live here:

* ``require_ops_proxy_token`` — the auth gate. The standalone ops server (which
  holds the Railway/Sentry tokens) calls these read-only endpoints with a shared
  secret in the ``X-Ops-Proxy-Token`` header; we compare it to
  ``settings.ops_proxy_token`` in constant time. This replaces the old JWT/role
  gate, so the slice depends on neither identity nor an ``ops_viewer`` row — no
  migration, no DB role.
* ``get_ops_service`` — assembles ``OpsService`` from the request-scoped DB
  session, the process-wide R2 storage client, and the in-process metrics
  registry singleton. (Railway/Sentry are no longer the backend's job.)
"""

from __future__ import annotations

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.metrics import metrics_registry
from app.core.storage import StorageClient, get_storage
from app.features.ops.service import OpsService


async def require_ops_proxy_token(
    x_ops_proxy_token: Annotated[str | None, Header(alias="X-Ops-Proxy-Token")] = None,
) -> None:
    """Gate ``/api/ops/*`` with a shared secret header (constant-time compare).

    Fail-closed: if no token is configured on this backend, nobody gets in — a
    blank ``ops_proxy_token`` must never mean "open to all".
    """
    expected = settings.ops_proxy_token
    if not expected:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "ops proxy token not configured")
    if not hmac.compare_digest(x_ops_proxy_token or "", expected):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid ops proxy token")


def get_ops_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    storage: Annotated[StorageClient, Depends(get_storage)],
) -> OpsService:
    return OpsService(session, storage, metrics_registry)


OpsServiceDep = Annotated[OpsService, Depends(get_ops_service)]
