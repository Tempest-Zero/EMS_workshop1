"""HTTP endpoints for the customers slice (mounted under ``/api`` →
``/api/customers``).

Consent is the slice's first HTTP surface: the mobile intake's consent chip
(and any later withdrawal) writes the append-only ``customer_consent_event``
log through here. Auth-required — consent facts are customer PII.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.customers.schemas import ConsentRequest, ConsentState, CustomerLookupOut
from app.features.customers.service import (
    CustomerNotFoundError,
    lookup_customer_by_phone,
    record_consent,
)
from app.features.identity.deps import CurrentPrincipal
from app.shared.tenancy import DEFAULT_SHOP_ID

router = APIRouter(prefix="/customers", tags=["customers"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ShopId = Annotated[str, Query(max_length=64)]


@router.get(
    "/lookup",
    response_model=CustomerLookupOut | None,
    summary="Repeat-customer lookup by phone (any authenticated caller)",
)
async def lookup_customer(
    session: SessionDep,
    principal: CurrentPrincipal,
    phone: Annotated[str, Query(max_length=32)],
    shop_id: ShopId = DEFAULT_SHOP_ID,
) -> CustomerLookupOut | None:
    # The intake "is this a repeat customer?" chip. Returns null for an unknown,
    # unrecognizable, or ambiguous (household-shared) number — never an error,
    # so the phone can call it on every keystroke without special-casing 404s.
    customer = await lookup_customer_by_phone(session, phone, shop_id)
    if customer is None:
        return None
    return CustomerLookupOut(id=customer.id, full_name=customer.full_name)


@router.post(
    "/{customer_id}/consent",
    response_model=ConsentState,
    status_code=status.HTTP_201_CREATED,
    summary="Record a consent event (given/withdrawn) and update current state",
)
async def post_consent(
    customer_id: UUID,
    body: ConsentRequest,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> ConsentState:
    try:
        customer = await record_consent(
            session,
            customer_id=customer_id,
            kind=body.kind,
            scope=body.scope,
            channel=body.channel,
            recorded_by=principal.tech_id,
        )
    except CustomerNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return ConsentState(
        customer_id=customer.id,
        whatsapp_opt_in_at=customer.whatsapp_opt_in_at,
        consent_contact_at=customer.consent_contact_at,
    )
