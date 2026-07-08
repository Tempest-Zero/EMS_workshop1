"""Telemetry slice — dependency providers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.telemetry.repository import TelemetryRepository
from app.features.telemetry.service import TelemetryService


def get_telemetry_service(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> TelemetryService:
    return TelemetryService(TelemetryRepository(session))


TelemetryServiceDep = Annotated[TelemetryService, Depends(get_telemetry_service)]
