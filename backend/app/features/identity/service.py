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
from app.features.identity.schemas import LoginResponse, TechnicianPublic
from app.features.identity.security import create_access_token, hash_pin, verify_pin
from app.features.identity.throttle import (
    is_locked,
    next_lock_until,
    retry_after_seconds,
)

# Managers reach payroll, customer PII and the revenue ledger — a 4-digit PIN
# is too thin for that account. Technicians keep 4 (workshop ergonomics).
MIN_PIN_DIGITS_TECH = 4
MIN_PIN_DIGITS_MANAGER = 6


class InvalidCredentialsError(Exception):
    """Raised on an unknown tech id, wrong PIN, or an inactive account."""


class AccountLockedError(Exception):
    """Raised while the account's login lock is in effect."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(f"too many attempts — retry in {retry_after}s")
        self.retry_after = retry_after


class PinPolicyError(Exception):
    """Raised when a new PIN doesn't meet the policy for the target account."""


class NotPermittedError(Exception):
    """Raised when the caller may not act on the target account."""


class TechnicianNotFoundError(LookupError):
    """Raised when the target technician doesn't exist."""


class IdentityService:
    def __init__(self, repo: IdentityRepository) -> None:
        self._repo = repo

    async def login(self, *, tech_id: str, pin: str) -> LoginResponse:
        """Verify a PIN and mint a JWT, enforcing the per-account lockout.

        Mutates throttle state on BOTH outcomes (counter bump on failure, reset
        on success) — the router must commit before surfacing the error, or the
        counter silently rolls back with the 401.
        """
        tech = await self._repo.get(tech_id)
        # Unknown/inactive ids keep today's generic 401 (the roster is public,
        # but don't add a new oracle distinguishing "missing" from "wrong PIN").
        if tech is None or not tech.active:
            raise InvalidCredentialsError("invalid tech id or PIN")

        now = datetime.now(UTC)
        if is_locked(tech.locked_until, now):
            raise AccountLockedError(retry_after_seconds(tech.locked_until, now))

        if not verify_pin(pin, tech.pin_hash):
            # `or 0`: a not-yet-flushed instance has None here (SQLAlchemy
            # column defaults apply at INSERT, not at construction).
            tech.failed_attempts = (tech.failed_attempts or 0) + 1
            tech.locked_until = next_lock_until(tech.failed_attempts, now)
            await self._repo.flush()
            raise InvalidCredentialsError("invalid tech id or PIN")

        # Success: clear throttle state; escalation only ever resets here.
        tech.failed_attempts = 0
        tech.locked_until = None
        await self._repo.flush()
        token = create_access_token(
            tech_id=tech.id,
            role=tech.role,
            name=tech.name,
            token_version=tech.token_version or 0,
        )
        return LoginResponse(token=token, technician=TechnicianPublic.model_validate(tech))

    async def roster(self) -> list[TechnicianPublic]:
        techs = await self._repo.list_active()
        return [TechnicianPublic.model_validate(t) for t in techs]

    async def set_pin(self, *, actor_id: str, actor_role: str, tech_id: str, pin: str) -> None:
        """Set a technician's PIN. A manager may set anyone's; a tech only their own.

        Deliberately does NOT bump ``token_version``: rotating a PIN must not
        401 the holder's phone — the installed APK's outbox drops queued writes
        on 401 (fixed in the Phase 3 build). Session killing is the separate,
        explicit ``revoke_sessions``. Revisit once the v2 outbox is rolled out.
        """
        if actor_role != "manager" and actor_id != tech_id:
            raise NotPermittedError("only a manager may set another technician's PIN")
        tech = await self._load(tech_id)
        self._check_pin_policy(pin, tech)
        tech.pin_hash = hash_pin(pin)
        # A fresh PIN is a fresh start for the throttle.
        tech.failed_attempts = 0
        tech.locked_until = None
        await self._repo.flush()

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

    @staticmethod
    def _check_pin_policy(pin: str, tech: Technician) -> None:
        if not pin.isdigit():
            raise PinPolicyError("PIN must be digits only")
        minimum = MIN_PIN_DIGITS_MANAGER if tech.role == "manager" else MIN_PIN_DIGITS_TECH
        if len(pin) < minimum:
            raise PinPolicyError(f"PIN for a {tech.role} account must be at least {minimum} digits")
