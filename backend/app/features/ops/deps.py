"""Dependency wiring for the ops slice.

Assembles ``OpsService`` from the request-scoped DB session, the process-wide R2
storage client, and the in-process metrics registry singleton. The Railway and
Sentry proxy clients are constructed from settings and attached here too once
those modules land.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.core.metrics import metrics_registry
from app.core.storage import StorageClient, get_storage
from app.features.ops.service import OpsService


def get_ops_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    storage: Annotated[StorageClient, Depends(get_storage)],
) -> OpsService:
    return OpsService(session, storage, metrics_registry)


OpsServiceDep = Annotated[OpsService, Depends(get_ops_service)]
