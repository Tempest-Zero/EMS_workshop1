"""Deterministic ``appliance_type`` → ``category_id`` map (jobs-local).

Lives in the jobs slice on purpose: the intake writer fills ``job.category_id``
from this dict with no cross-slice import and no DB round-trip. Migration 0023
backfills existing rows with the same key/value pairs. Keys are lowercased,
trimmed ``appliance_type`` strings; an unknown type leaves ``category_id`` NULL
(the category picker sets it explicitly over time). Every value must exist in
``appliance_category`` (seeded by 0023).
"""

from __future__ import annotations

APPLIANCE_TYPE_TO_CATEGORY: dict[str, str] = {
    "ac": "ac",
    "split ac": "ac",
    "window ac": "ac",
    "air conditioner": "ac",
    "refrigerator": "refrigerator",
    "fridge": "refrigerator",
    "deep freezer": "deep_freezer",
    "freezer": "deep_freezer",
    "washing machine": "washing_machine",
    "washer": "washing_machine",
    "water dispenser": "water_dispenser",
    "microwave": "microwave",
    "microwave oven": "microwave",
    "oven": "oven",
    "tv": "tv",
    "television": "tv",
    "led tv": "tv",
    "other": "other",
}


def category_for_appliance_type(appliance_type: str | None) -> str | None:
    """Map a raw ``appliance_type`` to a ``category_id``, or ``None`` if unknown."""
    if not appliance_type:
        return None
    return APPLIANCE_TYPE_TO_CATEGORY.get(appliance_type.strip().lower())
