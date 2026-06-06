"""Identity slice — business logic: authenticate a PIN, mint a token, list roster.

The public surface for "who is the caller": other slices don't reach in here,
they depend on ``get_current_principal`` (deps.py), which verifies the token
this service issues.
"""

from __future__ import annotations

from app.features.identity.repository import IdentityRepository
from app.features.identity.schemas import LoginResponse, TechnicianPublic
from app.features.identity.security import create_access_token, verify_pin


class InvalidCredentialsError(Exception):
    """Raised on an unknown tech id, wrong PIN, or an inactive account."""


class IdentityService:
    def __init__(self, repo: IdentityRepository) -> None:
        self._repo = repo

    async def login(self, *, tech_id: str, pin: str) -> LoginResponse:
        tech = await self._repo.get(tech_id)
        # Verify even when the tech is missing/inactive would let timing leak
        # which ids exist; the difference is negligible for a 5-person roster,
        # so we keep it simple and just reject.
        if tech is None or not tech.active or not verify_pin(pin, tech.pin_hash):
            raise InvalidCredentialsError("invalid tech id or PIN")
        token = create_access_token(tech_id=tech.id, role=tech.role, name=tech.name)
        return LoginResponse(token=token, technician=TechnicianPublic.model_validate(tech))

    async def roster(self) -> list[TechnicianPublic]:
        techs = await self._repo.list_active()
        return [TechnicianPublic.model_validate(t) for t in techs]
