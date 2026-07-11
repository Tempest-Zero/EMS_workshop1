"""HTTP endpoints for the customer_messaging slice.

Two routers, two trust models:

* ``router`` (``/api/messaging/…``) — the technician-facing surface behind the
  F15 Send button. JWT-authenticated like every jobs endpoint.
* ``webhook_router`` (``/api/webhooks/whatsapp``) — Meta's callback. No JWT:
  the GET handshake proves the verify token, and every POST is authenticated
  by its ``X-Hub-Signature-256`` HMAC (fail-closed when no app secret is
  configured).
"""

from __future__ import annotations

import hmac
import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.features.customer_messaging.deps import MessagingServiceDep
from app.features.customer_messaging.schemas import (
    MessageKind,
    MessageOut,
    MessagePreview,
    SendRequest,
    WebhookResult,
)
from app.features.customer_messaging.service import NoBillError, verify_webhook_signature

# Cross-slice consumption goes through the other slice's deps/service surface —
# never its repository. The job read + timeline write stay owned by jobs; the
# consent read stays owned by customers.
from app.features.customers.service import get_whatsapp_opt_in
from app.features.identity.deps import CurrentPrincipal
from app.features.jobs.deps import JobsServiceDep
from app.features.jobs.schemas import DEFAULT_SHOP_ID, JobDetail
from app.features.jobs.service import JobNotFoundError

router = APIRouter(prefix="/messaging", tags=["messaging"])
webhook_router = APIRouter(prefix="/webhooks/whatsapp", tags=["messaging"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
KindQuery = Annotated[MessageKind, Query()]


@router.get(
    "/jobs/{job_id}/whatsapp/preview",
    response_model=MessagePreview,
    summary="Composed message + wa.me link + consent state (the Send button's input)",
)
async def preview(
    job_id: UUID,
    service: MessagingServiceDep,
    jobs: JobsServiceDep,
    session: SessionDep,
    _principal: CurrentPrincipal,
    kind: KindQuery = "bill",
) -> MessagePreview:
    try:
        job = await jobs.get_job(job_id=job_id, shop_id=DEFAULT_SHOP_ID)
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    opt_in_at = await get_whatsapp_opt_in(session, job.customer_id) if job.customer_id else None
    try:
        return service.preview(job, kind=kind, opt_in_at=opt_in_at)
    except NoBillError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


@router.post(
    "/jobs/{job_id}/whatsapp/send-log",
    response_model=JobDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Record a click-to-chat send on the job timeline (the phone owns the send)",
)
async def send_log(
    job_id: UUID,
    body: SendRequest,
    jobs: JobsServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> JobDetail:
    try:
        detail = await jobs.log_customer_message(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            kind=body.kind,
            channel="clicktochat",
            actor=principal.tech_id,
        )
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return detail


@router.post(
    "/jobs/{job_id}/whatsapp/send",
    response_model=MessageOut,
    summary="Send via the Cloud API (idempotent per job+kind; 503 until configured)",
)
async def send(
    job_id: UUID,
    body: SendRequest,
    service: MessagingServiceDep,
    jobs: JobsServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
) -> MessageOut:
    if not settings.whatsapp_cloud_enabled:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "WhatsApp Cloud API is not configured — use the click-to-chat flow",
        )
    try:
        job = await jobs.get_job(job_id=job_id, shop_id=DEFAULT_SHOP_ID)
    except JobNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    opt_in_at = await get_whatsapp_opt_in(session, job.customer_id) if job.customer_id else None
    try:
        row, sent_now = await service.send_cloud_message(job, kind=body.kind, opt_in_at=opt_in_at)
    except NoBillError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    if sent_now:
        # Mirror the click-to-chat write: the send lands on the job timeline.
        await jobs.log_customer_message(
            job_id=job_id,
            shop_id=DEFAULT_SHOP_ID,
            kind=body.kind,
            channel="cloud_api",
            actor=principal.tech_id,
        )
    await session.commit()
    return MessageOut.model_validate(row)


# ── Meta webhooks ─────────────────────────────────────────────────────────────
@webhook_router.get("", summary="Meta's one-time subscription verification handshake")
async def verify_subscription(
    mode: Annotated[str | None, Query(alias="hub.mode")] = None,
    token: Annotated[str | None, Query(alias="hub.verify_token")] = None,
    challenge: Annotated[str | None, Query(alias="hub.challenge")] = None,
) -> PlainTextResponse:
    configured = settings.whatsapp_webhook_verify_token
    if (
        configured
        and mode == "subscribe"
        and token is not None
        and hmac.compare_digest(token, configured)
        and challenge is not None
    ):
        return PlainTextResponse(challenge)
    raise HTTPException(status.HTTP_403_FORBIDDEN, "verification failed")


@webhook_router.post("", response_model=WebhookResult, summary="Delivery statuses + inbound")
async def receive_webhook(
    request: Request,
    service: MessagingServiceDep,
    session: SessionDep,
) -> WebhookResult:
    raw = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not verify_webhook_signature(settings.whatsapp_app_secret, raw, signature):
        # Fail-closed: unsigned, mis-signed, or unconfigured — all 403.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed JSON") from e
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unexpected payload shape")
    statuses_applied, inbound_seen = await service.process_webhook(payload)
    await session.commit()
    return WebhookResult(statuses_applied=statuses_applied, inbound_seen=inbound_seen)
