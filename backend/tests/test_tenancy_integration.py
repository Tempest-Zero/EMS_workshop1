"""Integration tests for the tenancy root (migration 0020).

The ``shop_id`` FKs are the load-bearing change: a row referencing a shop that
does not exist must be rejected by the database, not silently accepted. Runs
against real Postgres (skipped without ``FIXFLOW_TEST_DATABASE_URL``).
"""

from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.models import Technician
from app.features.identity.security import hash_pin
from app.features.tenancy.models import Shop

pytestmark = pytest.mark.integration


async def test_default_shop_is_seeded(session: AsyncSession) -> None:
    # The session fixture seeds the 'default' shop that every FK references.
    shop = await session.get(Shop, "default")
    assert shop is not None


async def test_unknown_shop_id_is_rejected(session: AsyncSession) -> None:
    # A technician pointing at a shop that doesn't exist violates fk_technician_shop.
    session.add(
        Technician(
            id="ghost-tech",
            name="Ghost",
            role="tech",
            pin_hash=hash_pin("1234"),
            active=True,
            shop_id="no-such-shop",
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()
    await session.rollback()
