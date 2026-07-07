"""Customers slice — the public service surface.

``match_customer_by_phone`` is the one function other slices use: jobs' intake
calls it to best-effort link a new job to an existing customer. It matches only
when a single (merge-resolved) customer in the shop owns the normalized phone —
0 or ambiguous (>1) matches return ``None`` (never auto-create, never
auto-merge; households share numbers, so a shared number is deliberately not a
match). Backfill creates the customers this matches against
(``scripts/backfill_customers.py``); until then it simply returns ``None``.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.customers.models import Customer, CustomerPhone

# Pakistani mobile after punctuation is stripped: optional +92 / 0092 / 0 prefix,
# then a 10-digit mobile starting with 3 (e.g. 0300-1234567, +92 300 1234567).
_PK_MOBILE = re.compile(r"^(?:\+?92|0092|0)?(3\d{9})$")


def normalize_phone_e164(raw: str | None) -> str | None:
    """Recognizable Pakistani mobiles → E.164 (``+923XXXXXXXXX``); else ``None``.

    Lenient by design: a landline, foreign, or garbled number returns ``None``
    (it just won't match a customer), never an error.
    """
    if not raw:
        return None
    digits = re.sub(r"[^\d+]", "", raw)
    m = _PK_MOBILE.match(digits)
    if m is None:
        return None
    return "+92" + m.group(1)


async def match_customer_by_phone(
    session: AsyncSession, raw_phone: str | None, shop_id: str
) -> UUID | None:
    """The customer id iff exactly one shop customer owns this phone, else None."""
    normalized = normalize_phone_e164(raw_phone)
    if normalized is None:
        return None
    stmt = (
        select(Customer)
        .join(CustomerPhone, CustomerPhone.customer_id == Customer.id)
        .where(CustomerPhone.phone_e164 == normalized, Customer.shop_id == shop_id)
    )
    customers = (await session.execute(stmt)).scalars().all()
    # Resolve merge pointers to the winner, then dedupe: a household with two
    # customer rows sharing a number is ambiguous → no match.
    winners = {c.merged_into_customer_id or c.id for c in customers}
    if len(winners) == 1:
        return next(iter(winners))
    return None
