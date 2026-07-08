"""Data access for `device` + `device_token`. Thin — the service owns logic."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.notifications.models import Device, DeviceToken


class NotificationRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert_device(
        self,
        *,
        installation_id: str,
        tech_id: str,
        platform: str,
        app_version: str | None,
        os_version: str | None,
    ) -> UUID:
        """Register or refresh a fleet device, keyed by its Expo installation id.
        Binds the current tech, refreshes versions (only when supplied so a
        sparse call never wipes a known value), and beats the heartbeat."""
        existing = await self._session.execute(
            select(Device).where(Device.installation_id == installation_id)
        )
        row = existing.scalar_one_or_none()
        now = datetime.now(UTC)
        if row is None:
            row = Device(
                installation_id=installation_id,
                tech_id=tech_id,
                platform=platform,
                app_version=app_version,
                os_version=os_version,
                last_seen_at=now,
            )
            self._session.add(row)
        else:
            row.tech_id = tech_id
            row.platform = platform
            if app_version is not None:
                row.app_version = app_version
            if os_version is not None:
                row.os_version = os_version
            row.last_seen_at = now
        await self._session.flush()
        return row.id

    async def upsert_token(
        self, *, tech_id: str, token: str, platform: str, device_id: UUID | None = None
    ) -> None:
        """Register a push token. Unique on ``token`` — re-registering the same
        device just refreshes its owner/platform (devices can be re-assigned)."""
        existing = await self._session.execute(
            select(DeviceToken).where(DeviceToken.token == token)
        )
        row = existing.scalar_one_or_none()
        if row is None:
            self._session.add(
                DeviceToken(tech_id=tech_id, token=token, platform=platform, device_id=device_id)
            )
        else:
            row.tech_id = tech_id
            row.platform = platform
            if device_id is not None:
                row.device_id = device_id
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
