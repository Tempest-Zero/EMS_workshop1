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
from app.features.notifications.repository import NotificationRepository
from app.features.notifications.schemas import DeviceRegister
from app.features.notifications.service import NotificationService

router = APIRouter(prefix="/devices", tags=["notifications"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def get_service(session: SessionDep) -> NotificationService:
    return NotificationService(NotificationRepository(session))


ServiceDep = Annotated[NotificationService, Depends(get_service)]


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
