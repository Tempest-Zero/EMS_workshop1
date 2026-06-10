"""Pure geometry helpers — shared kernel (no business meaning, no deps).

Lives here because more than one slice needs great-circle distance: attendance
(geofence flags) and jobs (route distance → fuel estimate). Per the dependency
rules, ``shared/`` may be imported by any slice and imports nothing internal.
"""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in metres between two lat/lng points."""
    p1, p2 = radians(lat1), radians(lat2)
    dphi = radians(lat2 - lat1)
    dlambda = radians(lng2 - lng1)
    a = sin(dphi / 2) ** 2 + cos(p1) * cos(p2) * sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * asin(sqrt(a))
