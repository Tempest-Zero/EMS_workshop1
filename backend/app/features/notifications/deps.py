"""Notifications slice — dependency providers (the cross-slice construction
surface). The jobs slice imports ``get_notification_service`` from here for the
push-on-assign; the repository stays private to this slice.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.notifications.repository import NotificationRepository
from app.features.notifications.service import NotificationService


def get_notification_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> NotificationService:
    return NotificationService(NotificationRepository(session))


NotificationServiceDep = Annotated[NotificationService, Depends(get_notification_service)]
