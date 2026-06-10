"""Unit tests for the auth dependency's DB-backed checks (0013).

``get_current_principal`` now verifies the caller against the live technician
row: existence, ``active``, and the token's ``ver`` claim vs ``token_version``.
The session is stubbed — `IdentityRepository.get` resolves to `session.get`.
"""

from __future__ import annotations

from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.identity.deps import get_current_principal
from app.features.identity.models import Technician
from app.features.identity.security import create_access_token


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def _session_returning(tech: Technician | None) -> AsyncSession:
    session = MagicMock()
    session.get = AsyncMock(return_value=tech)
    return cast(AsyncSession, session)


def _row(**overrides: object) -> Technician:
    tech = Technician(
        id="t1", name="Imran Ahmed", role="manager", pin_hash="x", active=True, token_version=0
    )
    for key, value in overrides.items():
        setattr(tech, key, value)
    return tech


async def test_missing_token_is_401_before_any_db_access() -> None:
    session = MagicMock()  # would explode if touched — it must not be
    with pytest.raises(HTTPException) as exc:
        await get_current_principal(None, cast(AsyncSession, session))
    assert exc.value.status_code == 401


async def test_valid_token_with_matching_version_returns_live_row_identity() -> None:
    token = create_access_token(tech_id="t1", role="tech", name="Stale Name", token_version=2)
    # Row says manager + new name → the live row wins over stale token claims.
    principal = await get_current_principal(
        _creds(token), _session_returning(_row(token_version=2))
    )
    assert principal.tech_id == "t1"
    assert principal.role == "manager"
    assert principal.name == "Imran Ahmed"


async def test_pre_0013_token_without_ver_claim_stays_valid_at_version_zero() -> None:
    # Tokens issued before this deploy carry no `ver` → treated as 0; every row
    # starts at 0 → nobody is logged out by the deploy itself.
    token = create_access_token(tech_id="t1", role="manager", name="Imran")
    principal = await get_current_principal(
        _creds(token), _session_returning(_row(token_version=0))
    )
    assert principal.tech_id == "t1"


async def test_revoked_token_version_mismatch_is_401() -> None:
    token = create_access_token(tech_id="t1", role="manager", name="Imran", token_version=1)
    with pytest.raises(HTTPException) as exc:
        await get_current_principal(_creds(token), _session_returning(_row(token_version=2)))
    assert exc.value.status_code == 401


async def test_deleted_account_is_401() -> None:
    token = create_access_token(tech_id="t1", role="manager", name="Imran")
    with pytest.raises(HTTPException) as exc:
        await get_current_principal(_creds(token), _session_returning(None))
    assert exc.value.status_code == 401


async def test_deactivated_account_is_401() -> None:
    token = create_access_token(tech_id="t1", role="manager", name="Imran")
    with pytest.raises(HTTPException) as exc:
        await get_current_principal(_creds(token), _session_returning(_row(active=False)))
    assert exc.value.status_code == 401


async def test_garbage_token_is_401() -> None:
    with pytest.raises(HTTPException) as exc:
        await get_current_principal(_creds("not-a-jwt"), _session_returning(_row()))
    assert exc.value.status_code == 401
