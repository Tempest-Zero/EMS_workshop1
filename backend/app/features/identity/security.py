"""Auth primitives: password hashing (stdlib PBKDF2) and JWT issue/verify (HS256).

Kept dependency-light on purpose — only ``PyJWT`` is third-party; password hashing
uses ``hashlib.pbkdf2_hmac`` so there's no native password-hashing build to
ship.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import settings

_ALGORITHM = "HS256"
_PBKDF2_ITERATIONS = 120_000
_HASH_SCHEME = "pbkdf2_sha256"


def hash_password(password: str) -> str:
    """Return a self-describing ``scheme$iters$salt$hash`` string for a password."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{_HASH_SCHEME}${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of a password against a stored ``hash_password`` value."""
    try:
        scheme, iters, salt_hex, hash_hex = stored.split("$")
        if scheme != _HASH_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


def validate_password_strength(password: str) -> None:
    """Check password strength: min 8 chars, 1 upper, 1 digit, 1 special."""
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[A-Z]", password):
        raise ValueError("Password must contain at least one uppercase letter")
    if not re.search(r"\d", password):
        raise ValueError("Password must contain at least one number")
    if not re.search(r"[!@#$%^&*()_\-=\+\[\]{}|;:,.<>?]", password):
        raise ValueError("Password must contain at least one special character")


def create_access_token(
    *, tech_id: str, role: str, name: str, must_change_password: bool, token_version: int = 0
) -> str:
    """Sign a JWT whose ``sub`` is the tech id (server-authoritative identity).

    ``token_version`` is embedded as the ``ver`` claim and checked on every
    authed request; bumping the tech's row invalidates all their live tokens.
    ``must_change_password`` is embedded as the ``mc`` claim.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": tech_id,
        "role": role,
        "name": name,
        "ver": token_version,
        "mc": must_change_password,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Verify signature + expiry and return the claims. Raises ``PyJWTError``."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
