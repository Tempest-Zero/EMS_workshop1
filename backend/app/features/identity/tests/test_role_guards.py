"""Unit tests for the role guards layered on top of ``get_current_principal``.

These are pure checks over an already-resolved ``Principal``, so they take a
``Principal`` directly (the token/DB verification is covered in ``test_deps``).
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.features.identity.deps import require_manager, require_ops_access
from app.features.identity.schemas import Principal


def _principal(role: str) -> Principal:
    return Principal(tech_id="x1", role=role, name="Test")


async def test_require_manager_allows_manager() -> None:
    p = await require_manager(_principal("manager"))
    assert p.role == "manager"


@pytest.mark.parametrize("role", ["tech", "ops_viewer"])
async def test_require_manager_rejects_non_manager(role: str) -> None:
    with pytest.raises(HTTPException) as exc:
        await require_manager(_principal(role))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["ops_viewer", "manager"])
async def test_require_ops_access_allows_ops_and_manager(role: str) -> None:
    p = await require_ops_access(_principal(role))
    assert p.role == role


async def test_require_ops_access_rejects_technician() -> None:
    with pytest.raises(HTTPException) as exc:
        await require_ops_access(_principal("tech"))
    assert exc.value.status_code == 403
