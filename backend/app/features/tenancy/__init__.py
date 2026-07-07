"""Tenancy slice — the shop (tenant root) and, from W2, the geographic ``area``.

``shop`` is the row every ``shop_id`` column now references; the system runs as
the single seeded ``'default'`` shop today (multi-tenant is a future goal). This
slice is models-only for now — no router, no service. The kernel constant
``DEFAULT_SHOP_ID`` lives in ``app/shared/tenancy.py``.
"""
