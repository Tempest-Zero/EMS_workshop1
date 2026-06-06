"""Unit tests for the auth primitives — pure, no DB."""

from __future__ import annotations

import jwt
import pytest

from app.features.identity.security import (
    create_access_token,
    decode_access_token,
    hash_pin,
    verify_pin,
)


def test_hash_pin_roundtrips_and_is_salted() -> None:
    h1 = hash_pin("1234")
    h2 = hash_pin("1234")
    assert h1 != h2  # random salt → different strings for the same PIN
    assert verify_pin("1234", h1) is True
    assert verify_pin("1234", h2) is True


def test_verify_pin_rejects_wrong_pin_and_garbage() -> None:
    stored = hash_pin("1234")
    assert verify_pin("0000", stored) is False
    assert verify_pin("1234", "not-a-valid-hash") is False
    assert verify_pin("1234", "") is False


def test_token_roundtrips_claims() -> None:
    token = create_access_token(tech_id="t1", role="manager", name="Imran")
    claims = decode_access_token(token)
    assert claims["sub"] == "t1"
    assert claims["role"] == "manager"
    assert claims["name"] == "Imran"


def test_decode_rejects_a_tampered_token() -> None:
    token = create_access_token(tech_id="t1", role="tech", name="x")
    # Flip the last char of the signature so the structure is intact but the
    # signature no longer verifies.
    tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
    with pytest.raises(jwt.PyJWTError):
        decode_access_token(tampered)
