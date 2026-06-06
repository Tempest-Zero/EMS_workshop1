"""Auth primitives: PIN hashing (stdlib PBKDF2) and JWT issue/verify (HS256).

Kept dependency-light on purpose — only ``PyJWT`` is third-party; PIN hashing
uses ``hashlib.pbkdf2_hmac`` so there's no native password-hashing build to
ship. PINs are low-entropy by nature, so PBKDF2 is about slowing offline
guessing of a leaked hash, not pretending a 4-digit PIN is a strong secret.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt

from app.core.config import settings

_ALGORITHM = "HS256"
_PBKDF2_ITERATIONS = 120_000
_HASH_SCHEME = "pbkdf2_sha256"


def hash_pin(pin: str) -> str:
    """Return a self-describing ``scheme$iters$salt$hash`` string for a PIN."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"{_HASH_SCHEME}${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_pin(pin: str, stored: str) -> bool:
    """Constant-time check of a PIN against a stored ``hash_pin`` value."""
    try:
        scheme, iters, salt_hex, hash_hex = stored.split("$")
        if scheme != _HASH_SCHEME:
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256", pin.encode("utf-8"), bytes.fromhex(salt_hex), int(iters)
        )
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(digest.hex(), hash_hex)


def create_access_token(*, tech_id: str, role: str, name: str) -> str:
    """Sign a JWT whose ``sub`` is the tech id (server-authoritative identity)."""
    now = datetime.now(UTC)
    payload = {
        "sub": tech_id,
        "role": role,
        "name": name,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Verify signature + expiry and return the claims. Raises ``PyJWTError``."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[_ALGORITHM])
