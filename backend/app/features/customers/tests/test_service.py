"""Unit tests for customer phone normalization (pure — no DB)."""

from __future__ import annotations

import pytest

from app.features.customers.service import normalize_phone_e164


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("0300-1234567", "+923001234567"),
        ("+92 300 1234567", "+923001234567"),
        ("3001234567", "+923001234567"),
        ("00923001234567", "+923001234567"),
        ("923001234567", "+923001234567"),
        ("0300 1234567", "+923001234567"),
        (None, None),
        ("", None),
        ("021-34567890", None),  # landline (not 3XXXXXXXXX) → no match
        ("not a phone", None),
        ("+1 415 555 0100", None),  # foreign → no match
    ],
)
def test_normalize_phone_e164(raw: str | None, expected: str | None) -> None:
    assert normalize_phone_e164(raw) == expected
