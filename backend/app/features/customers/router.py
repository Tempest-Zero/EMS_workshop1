"""HTTP endpoints for the customers slice (mounted under ``/api`` →
``/api/customers``).

Consent is the slice's first HTTP surface: the mobile intake's consent chip
(and any later withdrawal) writes the append-only ``customer_consent_event``
log through here. Auth-required — consent facts are customer PII.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.customers.schemas import ConsentRequest, ConsentState
from app.features.customers.service import CustomerNotFoundError, record_consent
from app.features.identity.deps import CurrentPrincipal

router = APIRouter(prefix="/customers", tags=["customers"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


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
