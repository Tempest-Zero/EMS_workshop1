"""Customer messaging slice — dependency providers (the cross-slice
construction surface). Other slices and the composition root build the
service from here; the repository stays private."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.customer_messaging.repository import CustomerMessageRepository
from app.features.customer_messaging.service import MessagingService


def get_messaging_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> MessagingService:
    return MessagingService(CustomerMessageRepository(session))


MessagingServiceDep = Annotated[MessagingService, Depends(get_messaging_service)]
