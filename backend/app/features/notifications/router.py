"""HTTP endpoints for the notifications slice (mounted under ``/api``).

Device-token registration only; sending is internal (the jobs slice calls the
service on assignment). Auth-required — a token is tied to the logged-in tech.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentPrincipal

# Construction lives in deps.py (the cross-slice surface shared with jobs'
# push-on-assign). Aliased so this router's tests keep their override seam.
from app.features.notifications.deps import NotificationServiceDep as ServiceDep
from app.features.notifications.schemas import DeviceRegister

router = APIRouter(prefix="/devices", tags=["notifications"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Register this device's push token for the logged-in technician",
)
async def register_device(
    body: DeviceRegister,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> None:
    await service.register(tech_id=principal.tech_id, token=body.token, platform=body.platform)
    await session.commit()
