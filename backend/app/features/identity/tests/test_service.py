"""Unit tests for `IdentityService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.identity.models import Technician
from app.features.identity.security import decode_access_token, hash_pin
from app.features.identity.service import IdentityService, InvalidCredentialsError


def _tech(**overrides: object) -> Technician:
    tech = Technician(
        id="t1",
        name="Imran Ahmed",
        specialty="AC Specialist",
        phone="0312-2345678",
        avatar="bg-indigo-500",
        role="manager",
        pin_hash=hash_pin("1234"),
        active=True,
    )
    for key, value in overrides.items():
        setattr(tech, key, value)
    return tech


@pytest.fixture
def svc() -> Iterator[tuple[IdentityService, MagicMock]]:
    repo = MagicMock()
    repo.get = AsyncMock()
    repo.list_active = AsyncMock(return_value=[])
    yield IdentityService(repo), repo


async def test_login_success_returns_token_with_identity(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _tech()

    resp = await service.login(tech_id="t1", pin="1234")

    assert resp.technician.id == "t1"
    claims = decode_access_token(resp.token)
    assert claims["sub"] == "t1"
    assert claims["role"] == "manager"


async def test_login_wrong_pin_raises(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _tech()
    with pytest.raises(InvalidCredentialsError):
        await service.login(tech_id="t1", pin="0000")


async def test_login_unknown_tech_raises(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = None
    with pytest.raises(InvalidCredentialsError):
        await service.login(tech_id="ghost", pin="1234")


async def test_login_inactive_tech_raises(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _tech(active=False)
    with pytest.raises(InvalidCredentialsError):
        await service.login(tech_id="t1", pin="1234")


async def test_roster_excludes_pin_hash(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.list_active.return_value = [_tech()]
    roster = await service.roster()
    assert roster[0].id == "t1"
    # The public schema simply has no pin field to leak.
    assert not hasattr(roster[0], "pin_hash")
