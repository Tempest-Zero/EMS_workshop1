"""Data access for `device_token`. Thin — the service owns logic."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.notifications.models import DeviceToken


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert_token(self, *, tech_id: str, token: str, platform: str) -> None:
        """Register a push token. Unique on ``token`` — re-registering the same
        device just refreshes its owner/platform (devices can be re-assigned)."""
        existing = await self._session.execute(
            select(DeviceToken).where(DeviceToken.token == token)
        )
        row = existing.scalar_one_or_none()
        if row is None:
            self._session.add(DeviceToken(tech_id=tech_id, token=token, platform=platform))
        else:
            row.tech_id = tech_id
            row.platform = platform
            row.updated_at = datetime.now(UTC)
        await self._session.flush()

    async def list_tokens(self, tech_id: str) -> list[str]:
        result = await self._session.execute(
            select(DeviceToken.token).where(DeviceToken.tech_id == tech_id)
        )
        return list(result.scalars())

    async def delete_token(self, token: str) -> None:
        """Drop a dead device token (FCM said UNREGISTERED). Without this the
        registry only ever grows and every assignment fans out to ghosts."""
        await self._session.execute(delete(DeviceToken).where(DeviceToken.token == token))
