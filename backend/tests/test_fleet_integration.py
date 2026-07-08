"""Integration: the fleet device registry + token link (W10).

Real Postgres. Registering with an ``installation_id`` upserts a ``device`` row
(keyed by installation id), binds the tech, and links the push token to it.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician
from app.features.identity.security import hash_pin
from app.features.notifications.models import Device, DeviceToken
from app.features.notifications.repository import NotificationRepository
from app.features.notifications.service import NotificationService

pytestmark = pytest.mark.integration


async def _seed_tech(session: AsyncSession, tech_id: str = "t1") -> None:
    session.add(
        Technician(id=tech_id, name="Imran", role="tech", pin_hash=hash_pin("1234"), active=True)
    )
    await session.flush()


async def test_register_with_installation_id_upserts_device_and_links_token(
    session: AsyncSession,
) -> None:
    await _seed_tech(session)
    service = NotificationService(NotificationRepository(session))

    await service.register(
        tech_id="t1",
        token="ExponentPushToken[abc]",
        platform="android",
        installation_id="inst-123",
        app_version="1.4.0",
        os_version="Android 14",
    )
    await session.commit()

    device = (await session.execute(select(Device))).scalars().one()
    assert device.installation_id == "inst-123"
    assert device.tech_id == "t1"
    assert device.app_version == "1.4.0"
    assert device.os_version == "Android 14"
    assert device.last_seen_at is not None

    token = (await session.execute(select(DeviceToken))).scalars().one()
    assert token.device_id == device.id


async def test_re_register_same_installation_upserts_not_duplicates(
    session: AsyncSession,
) -> None:
    await _seed_tech(session)
    service = NotificationService(NotificationRepository(session))

    await service.register(
        tech_id="t1",
        token="tok-1",
        platform="android",
        installation_id="inst-9",
        app_version="1.0.0",
    )
    await service.register(
        tech_id="t1",
        token="tok-1",
        platform="android",
        installation_id="inst-9",
        app_version="1.1.0",
    )
    await session.commit()

    devices = (await session.execute(select(Device))).scalars().all()
    assert len(devices) == 1
    assert devices[0].app_version == "1.1.0"  # refreshed, not duplicated


async def test_register_without_installation_id_leaves_device_null(
    session: AsyncSession,
) -> None:
    await _seed_tech(session)
    service = NotificationService(NotificationRepository(session))

    await service.register(tech_id="t1", token="tok-legacy", platform="android")
    await session.commit()

    assert (await session.execute(select(Device))).scalars().all() == []
    token = (await session.execute(select(DeviceToken))).scalars().one()
    assert token.device_id is None
