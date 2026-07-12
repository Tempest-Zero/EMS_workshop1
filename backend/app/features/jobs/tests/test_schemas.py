"""Pure schema tests — the JobCreate phone canonicalization (no DB needed)."""

from __future__ import annotations

import pytest

from app.features.jobs.schemas import JobCreate


def _create(phone: str | None) -> JobCreate:
    return JobCreate(customer_name="Abdul", appliance_type="Split AC", customer_phone=phone)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("03001234567", "+923001234567"),
        ("0300-1234567", "+923001234567"),
        ("0300 123 4567", "+923001234567"),
        ("+923001234567", "+923001234567"),
        ("+92 300 1234567", "+923001234567"),
        ("923001234567", "+923001234567"),
        ("00923001234567", "+923001234567"),
        ("3001234567", "+923001234567"),
    ],
)
def test_pk_mobiles_canonicalize_to_e164(raw: str, expected: str) -> None:
    assert _create(raw).customer_phone == expected


@pytest.mark.parametrize(
    "raw",
    [
        "021-34567890",  # Karachi landline — kept, but not rewritten
        "+14155551234",  # foreign number
        "0300-1234567 (father)",  # annotated free text
    ],
)
def test_unrecognized_numbers_are_kept_as_typed(raw: str) -> None:
    # Lenient by contract: intake must never fail over the phone field.
    assert _create(raw).customer_phone == raw


def test_whitespace_only_phone_becomes_none() -> None:
    assert _create("   ").customer_phone is None
    assert _create(None).customer_phone is None


def test_surrounding_whitespace_is_trimmed() -> None:
    assert _create("  03001234567  ").customer_phone == "+923001234567"


def test_consent_defaults_off() -> None:
    assert _create(None).whatsapp_consent is False


# ── job_type inference (address ⇒ travel job unless the client says otherwise) ──


def test_address_without_type_defaults_to_home_visit() -> None:
    job = JobCreate(
        customer_name="Abdul",
        appliance_type="Split AC",
        customer_address="House 12, Gulshan",
    )
    assert job.job_type == "home-visit"


def test_no_address_and_no_type_stays_carry_in() -> None:
    job = JobCreate(customer_name="Abdul", appliance_type="Split AC")
    assert job.job_type == "carry-in"


def test_blank_address_does_not_flip_the_type() -> None:
    job = JobCreate(customer_name="Abdul", appliance_type="Split AC", customer_address="   ")
    assert job.job_type == "carry-in"


def test_explicit_type_always_wins_over_the_inference() -> None:
    job = JobCreate(
        customer_name="Abdul",
        appliance_type="Split AC",
        customer_address="House 12, Gulshan",
        job_type="carry-in",
    )
    assert job.job_type == "carry-in"
