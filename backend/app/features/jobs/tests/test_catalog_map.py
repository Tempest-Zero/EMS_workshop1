"""Unit tests for the appliance_type → category_id map (pure — no DB)."""

from __future__ import annotations

import pytest

from app.features.jobs.catalog_map import category_for_appliance_type


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Split AC", "ac"),
        ("split ac", "ac"),
        ("  Refrigerator  ", "refrigerator"),
        ("Washing Machine", "washing_machine"),
        ("Microwave", "microwave"),
        ("TV", "tv"),
        ("Other", "other"),
        ("Toaster", None),  # unmapped → NULL
        (None, None),
        ("", None),
    ],
)
def test_category_for_appliance_type(raw: str | None, expected: str | None) -> None:
    assert category_for_appliance_type(raw) == expected
