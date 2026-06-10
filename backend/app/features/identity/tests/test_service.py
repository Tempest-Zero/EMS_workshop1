"""Unit tests for `IdentityService` — repository mocked, no DB."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.identity.models import Technician
from app.features.identity.security import decode_access_token, hash_pin, verify_pin
from app.features.identity.service import (
    AccountLockedError,
    IdentityService,
    InvalidCredentialsError,
    NotPermittedError,
    PinPolicyError,
    TechnicianNotFoundError,
)


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
    repo.flush = AsyncMock()  # login/set_pin/revoke persist throttle + version state
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


# ── Login throttle / lockout (0013) ──────────────────────────────────────────
async def test_failed_logins_bump_counter_then_lock(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    tech = _tech()
    repo.get.return_value = tech

    # Four failures: counted, but not yet locked.
    for _ in range(4):
        with pytest.raises(InvalidCredentialsError):
            await service.login(tech_id="t1", pin="0000")
    assert tech.failed_attempts == 4
    assert tech.locked_until is None

    # Fifth consecutive failure crosses the threshold → locked.
    with pytest.raises(InvalidCredentialsError):
        await service.login(tech_id="t1", pin="0000")
    assert tech.failed_attempts == 5
    assert tech.locked_until is not None

    # While locked, even the CORRECT pin is rejected with the lock error.
    with pytest.raises(AccountLockedError) as exc:
        await service.login(tech_id="t1", pin="1234")
    assert exc.value.retry_after >= 1


async def test_successful_login_resets_throttle_state(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    tech = _tech(failed_attempts=3)
    repo.get.return_value = tech

    resp = await service.login(tech_id="t1", pin="1234")

    assert tech.failed_attempts == 0
    assert tech.locked_until is None
    assert resp.technician.id == "t1"


async def test_login_token_carries_the_row_version(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _tech(token_version=7)
    resp = await service.login(tech_id="t1", pin="1234")
    assert decode_access_token(resp.token)["ver"] == 7


async def test_expired_lock_lets_a_correct_pin_through(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    # Lock expired a minute ago; escalation state (failed_attempts) persists
    # until a SUCCESS, which then clears it.
    tech = _tech(failed_attempts=6, locked_until=datetime.now(UTC) - timedelta(minutes=1))
    repo.get.return_value = tech

    resp = await service.login(tech_id="t1", pin="1234")

    assert resp.technician.id == "t1"
    assert tech.failed_attempts == 0


# ── Set PIN ──────────────────────────────────────────────────────────────────
async def test_tech_may_set_only_their_own_pin(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _tech(id="t2", role="tech")

    with pytest.raises(NotPermittedError):
        await service.set_pin(actor_id="t5", actor_role="tech", tech_id="t2", pin="4321")

    await service.set_pin(actor_id="t2", actor_role="tech", tech_id="t2", pin="4321")
    assert verify_pin("4321", repo.get.return_value.pin_hash)


async def test_manager_may_set_anyones_pin(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    tech = _tech(id="t3", role="tech", failed_attempts=5, locked_until=datetime.now(UTC))
    repo.get.return_value = tech

    await service.set_pin(actor_id="t1", actor_role="manager", tech_id="t3", pin="9876")

    assert verify_pin("9876", tech.pin_hash)
    # A fresh PIN clears any lockout so the tech can log straight in.
    assert tech.failed_attempts == 0
    assert tech.locked_until is None


async def test_manager_account_needs_six_digit_pin(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    repo.get.return_value = _tech(role="manager")

    with pytest.raises(PinPolicyError):
        await service.set_pin(actor_id="t1", actor_role="manager", tech_id="t1", pin="1234")

    await service.set_pin(actor_id="t1", actor_role="manager", tech_id="t1", pin="123456")


async def test_pin_must_be_digits(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = _tech(role="tech")
    with pytest.raises(PinPolicyError):
        await service.set_pin(actor_id="t1", actor_role="manager", tech_id="t1", pin="abcd")


async def test_set_pin_does_not_revoke_sessions(svc: tuple[IdentityService, MagicMock]) -> None:
    # Deliberate (see service docstring): rotating a PIN must not 401 the
    # holder's phone — the installed APK's outbox drops queued writes on 401.
    service, repo = svc
    tech = _tech(role="tech", token_version=3)
    repo.get.return_value = tech

    await service.set_pin(actor_id="t1", actor_role="manager", tech_id="t1", pin="4321")

    assert tech.token_version == 3


async def test_set_pin_unknown_tech_raises(svc: tuple[IdentityService, MagicMock]) -> None:
    service, repo = svc
    repo.get.return_value = None
    with pytest.raises(TechnicianNotFoundError):
        await service.set_pin(actor_id="t1", actor_role="manager", tech_id="ghost", pin="4321")


# ── Revoke sessions ──────────────────────────────────────────────────────────
async def test_revoke_sessions_bumps_token_version(
    svc: tuple[IdentityService, MagicMock],
) -> None:
    service, repo = svc
    tech = _tech(token_version=2)
    repo.get.return_value = tech

    await service.revoke_sessions(tech_id="t1")

    assert tech.token_version == 3
