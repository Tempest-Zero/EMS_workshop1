"""Tenancy kernel constants — dependency-free, importable by any slice.

``DEFAULT_SHOP_ID`` is the single shop the system runs as today (multi-tenant is
a future goal; ``shop_id`` columns exist but every row is ``'default'``). It
lived in ``attendance/schemas.py`` historically and moved here in W1 (migration
0020) so the tenancy root and every slice can share it without importing another
feature.
"""

from __future__ import annotations

DEFAULT_SHOP_ID = "default"
