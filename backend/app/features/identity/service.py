"""Identity slice — business logic: authenticate a PIN, mint a token, list roster,
manage PINs and session revocation.

The public surface for "who is the caller": other slices don't reach in here,
they depend on ``get_current_principal`` (deps.py), which verifies the token
this service issues.

Login is throttled per account (``throttle.py`` holds the pure policy; the
technician row holds the state). The lock always decays — never a hard lock,
because there is exactly one manager account and a permanent lock would hand a
malicious technician a denial-of-service against the console.
"""

from __future__ import annotations

from datetime import UTC, datetime

from app.features.identity.models import Technician
from app.features.identity.repository import IdentityRepository
from app.features.identity.schemas import (
    LoginResponse,
    TechnicianCreate,
    TechnicianPublic,
    TechnicianUpdate,
)
from app.features.identity.security import (
    create_access_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from app.features.identity.throttle import (
    is_locked,
    next_lock_until,
    retry_after_seconds,
)

class InvalidCredentialsError(Exception):
    """Raised on an unknown username, wrong password, or an inactive account."""


class AccountLockedError(Exception):
    """Raised while the account's login lock is in effect."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"too many attempts — retry in {retry_after}s")
        self.retry_after = retry_after


class PasswordPolicyError(Exception):
    """Raised when a new password doesn't meet the strength policy."""


class UsernameConflictError(Exception):
    """Raised when trying to register a duplicate username."""


class TechnicianIdConflictError(Exception):
    """Raised when trying to register a duplicate technician ID."""


class NotPermittedError(Exception):
    """Raised when the caller may not act on the target account."""


class TechnicianNotFoundError(LookupError):
    """Raised when the target technician doesn't exist."""


class IdentityService:
    def __init__(self, repo: IdentityRepository) -> None:
        self._repo = repo

    async def login(self, *, username: str, password: str) -> LoginResponse:
        """Verify a password and mint a JWT, enforcing the per-account lockout.

        Mutates throttle state on BOTH outcomes (counter bump on failure, reset
        on success) — the router must commit before surfacing the error, or the
        counter silently rolls back with the 401.
        """
        tech = await self._repo.get_by_username(username)
        if tech is None or not tech.active:
            raise InvalidCredentialsError("invalid username or password")

        now = datetime.now(UTC)
        if is_locked(tech.locked_until, now):
            raise AccountLockedError(retry_after_seconds(tech.locked_until, now))

        if not verify_password(password, tech.password_hash):
            tech.failed_attempts = (tech.failed_attempts or 0) + 1
            tech.locked_until = next_lock_until(tech.failed_attempts, now)
            await self._repo.flush()
            raise InvalidCredentialsError("invalid username or password")

        # Success: clear throttle state; escalation only ever resets here.
        tech.failed_attempts = 0
        tech.locked_until = None
        await self._repo.flush()
        token = create_access_token(
            tech_id=tech.id,
            role=tech.role,
            name=tech.name,
            must_change_password=tech.must_change_password,
            token_version=tech.token_version or 0,
        )
        return LoginResponse(token=token, technician=TechnicianPublic.model_validate(tech))

    async def list_active(self) -> list[TechnicianPublic]:
        techs = await self._repo.list_active()
        return [TechnicianPublic.model_validate(t) for t in techs]

    async def list_all(self) -> list[TechnicianPublic]:
        techs = await self._repo.list_all(include_inactive=True)
        return [TechnicianPublic.model_validate(t) for t in techs]

    async def set_password(self, *, actor_id: str, actor_role: str, tech_id: str, password: str) -> None:
        """Set a technician's password. A manager may set anyone's; a tech only their own.
        Setting a password clears the must_change_password flag and invalidates all existing sessions.
        """
        if actor_role != "manager" and actor_id != tech_id:
            raise NotPermittedError("only a manager may set another technician's password")
        tech = await self._load(tech_id)
        
        try:
            validate_password_strength(password)
        except ValueError as e:
            raise PasswordPolicyError(str(e)) from e
            
        tech.password_hash = hash_password(password)
        tech.must_change_password = False
        tech.token_version = (tech.token_version or 0) + 1
        # A fresh password is a fresh start for the throttle.
        tech.failed_attempts = 0
        tech.locked_until = None
        await self._repo.flush()

    async def create_technician(self, body: TechnicianCreate) -> TechnicianPublic:
        if await self._repo.get(body.id) is not None:
            raise TechnicianIdConflictError(f"Technician ID {body.id} already exists")
        if await self._repo.get_by_username(body.username) is not None:
            raise UsernameConflictError(f"Username {body.username} already exists")
            
        try:
            validate_password_strength(body.password)
        except ValueError as e:
            raise PasswordPolicyError(str(e)) from e

        tech = Technician(
            id=body.id,
            username=body.username,
            name=body.name,
            role=body.role,
            specialty=body.specialty,
            phone=body.phone,
            avatar=body.avatar,
            password_hash=hash_password(body.password),
            must_change_password=True,
            active=True,
        )
        self._repo.add(tech)
        await self._repo.flush()
        return TechnicianPublic.model_validate(tech)

    async def update_technician(self, *, actor_id: str, tech_id: str, body: TechnicianUpdate) -> TechnicianPublic:
        tech = await self._load(tech_id)
        
        # Self-demotion guard
        if actor_id == tech_id and body.role == "tech" and tech.role == "manager":
            raise NotPermittedError("a manager cannot demote themselves")
            
        # Deactivation guard
        if body.active is False and tech.active is True and tech.role == "manager":
            active_managers = await self._repo.count_active_managers()
            if active_managers <= 1:
                raise NotPermittedError("cannot deactivate the only active manager account")
                
        # Role change invalidates existing sessions
        if body.role is not None and body.role != tech.role:
            tech.token_version = (tech.token_version or 0) + 1
            
        if body.name is not None:
            tech.name = body.name
        if body.specialty is not None:
            tech.specialty = body.specialty
        if body.phone is not None:
            tech.phone = body.phone
        if body.avatar is not None:
            tech.avatar = body.avatar
        if body.role is not None:
            tech.role = body.role
        if body.active is not None:
            tech.active = body.active
            
        await self._repo.flush()
        return TechnicianPublic.model_validate(tech)

    async def revoke_sessions(self, *, tech_id: str) -> None:
        """Invalidate every live JWT for a technician (lost-phone kill switch).

        Until the Phase 3 APK is on a phone, its outbox DROPS queued writes when
        it hits 401 — so for an active technician this is for lost/stolen
        devices only (where the queue is forfeit anyway). Manager-gated at the
        router.
        """
        tech = await self._load(tech_id)
        tech.token_version = (tech.token_version or 0) + 1
        await self._repo.flush()

    # ── Internals ────────────────────────────────────────────────────────
    async def _load(self, tech_id: str) -> Technician:
        tech = await self._repo.get(tech_id)
        if tech is None:
            raise TechnicianNotFoundError(f"technician {tech_id} not found")
        return tech


