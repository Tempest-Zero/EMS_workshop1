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

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.customers.models import Customer, CustomerConsentEvent, CustomerPhone
from app.shared.phone import to_e164_pk


class CustomerNotFoundError(Exception):
    """Raised when a consent write names a customer id that doesn't exist."""


def normalize_phone_e164(raw: str | None) -> str | None:
    """Recognizable Pakistani mobiles → E.164 (``+923XXXXXXXXX``); else ``None``.

    Lenient by design: a landline, foreign, or garbled number returns ``None``
    (it just won't match a customer), never an error. The rule itself lives in
    the shared kernel (``app.shared.phone``) so jobs' intake canonicalizer and
    WhatsApp addressing apply the identical spelling.
    """
    return to_e164_pk(raw)


async def lookup_customer_by_phone(
    session: AsyncSession, raw_phone: str | None, shop_id: str
) -> Customer | None:
    """The customer row iff exactly one shop customer owns this phone, else None.

    Same rule as ``match_customer_by_phone`` (0 or ambiguous → None), but returns
    the resolved winner row so callers can show the customer's name (the intake
    "is this a repeat customer?" lookup). Merge losers are followed to the
    winner via ``resolve_customer``.
    """
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
    if len(winners) != 1:
        return None
    return await resolve_customer(session, next(iter(winners)))


async def match_customer_by_phone(
    session: AsyncSession, raw_phone: str | None, shop_id: str
) -> UUID | None:
    """The customer id iff exactly one shop customer owns this phone, else None."""
    customer = await lookup_customer_by_phone(session, raw_phone, shop_id)
    return customer.id if customer is not None else None


async def resolve_customer(session: AsyncSession, customer_id: UUID) -> Customer | None:
    """The customer row, with dedupe-merge pointers followed to the winner.

    Reads must never act on a merged-away loser row (its consent columns stop
    being maintained); the pointer chain is short by construction (losers point
    at winners, winners aren't merged), but the walk is capped defensively.
    """
    current = await session.get(Customer, customer_id)
    for _ in range(5):
        if current is None or current.merged_into_customer_id is None:
            return current
        current = await session.get(Customer, current.merged_into_customer_id)
    return current


async def get_whatsapp_opt_in(session: AsyncSession, customer_id: UUID) -> datetime | None:
    """The (merge-resolved) customer's current WhatsApp consent timestamp —
    the one question the messaging slice asks before any send."""
    customer = await resolve_customer(session, customer_id)
    return customer.whatsapp_opt_in_at if customer is not None else None


async def record_consent(
    session: AsyncSession,
    *,
    customer_id: UUID,
    kind: str,
    scope: str,
    channel: str,
    recorded_by: str | None,
) -> Customer:
    """Append a consent event and maintain the denormalized current-state
    columns on ``customer`` (the table proves it; the columns answer "may
    we?"). Recorded against the merge-resolved winner."""
    customer = await resolve_customer(session, customer_id)
    if customer is None:
        raise CustomerNotFoundError(f"customer {customer_id} not found")
    session.add(
        CustomerConsentEvent(
            customer_id=customer.id,
            kind=kind,
            scope=scope,
            channel=channel,
            recorded_by=recorded_by,
        )
    )
    now = datetime.now(UTC)
    stamp = now if kind == "given" else None
    if scope == "whatsapp":
        customer.whatsapp_opt_in_at = stamp
    elif scope == "contact":
        customer.consent_contact_at = stamp
    customer.updated_at = now
    await session.flush()
    return customer


async def create_customer_with_phone(
    session: AsyncSession,
    *,
    shop_id: str,
    full_name: str,
    phone_e164: str,
    source: str = "walk_in",
) -> Customer:
    """Create a customer + primary phone in one go (the intake "no match:
    create on submit" path). The phone must already be E.164 — callers
    normalize via ``app.shared.phone`` first."""
    customer = Customer(shop_id=shop_id, full_name=full_name, source=source)
    session.add(customer)
    await session.flush()  # assigns customer.id for the phone row
    session.add(CustomerPhone(customer_id=customer.id, phone_e164=phone_e164, is_primary=True))
    await session.flush()
    return customer
