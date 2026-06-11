"""HTTP endpoints for the media slice.

Mounted by `app.main` under `/api`, so the full paths are
`/api/jobs/{job_id}/media[...]`. The router is intentionally thin: it wires
deps, calls the service, translates domain errors to HTTP, and commits the
session at the request boundary.

Uses FastAPI's modern `Annotated[..., Depends(...)]` dep syntax (PEP 593) so
defaults stay reusable and lint-clean.
"""

from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.features.identity.deps import CurrentPrincipal, get_current_principal

# The delete policy needs the job's status (evidence freezes at close). Jobs is
# reached through its public deps/service surface only — composition at the
# router layer avoids a service-level jobs↔media cycle.
from app.features.jobs.deps import JobsServiceDep
from app.features.jobs.schemas import DEFAULT_SHOP_ID

# Construction lives in deps.py (the cross-slice surface shared with jobs'
# close-gate). Aliased so this router's tests keep their override seam.
from app.features.media.deps import MediaServiceDep as ServiceDep
from app.features.media.schemas import (
    MediaCompleteRequest,
    MediaItem,
    MediaList,
    MediaUploadRequest,
    MediaUploadResponse,
)
from app.features.media.service import (
    MediaForbiddenError,
    MediaNotFoundError,
    MediaTooLargeError,
)

# Media carries customer/job evidence → every endpoint requires a logged-in
# caller (flat permissions; any valid token). The mobile + web clients both send
# the bearer token. (J0.5b — tech-facing endpoints are no longer open.)
router = APIRouter(
    prefix="/jobs/{job_id}/media",
    tags=["media"],
    dependencies=[Depends(get_current_principal)],
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "",
    response_model=MediaUploadResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Reserve a media row + mint signed upload URL",
)
async def request_upload(
    job_id: str,
    body: MediaUploadRequest,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
    jobs: JobsServiceDep,
) -> MediaUploadResponse:
    # Evidence must hang off a REAL job: without this check any authenticated
    # caller could reserve unlimited rows under arbitrary keys (the storage
    # path is prefixed with this id) and mint signed PUT URLs into the bucket —
    # and the closing-video gate counts rows by exactly this key.
    job_status = await jobs.status_by_token(token=job_id, shop_id=DEFAULT_SHOP_ID)
    if job_status is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"job {job_id} not found")
    # Evidence freezes at close (mirrors the delete policy below): adding
    # "evidence" to an already-closed job is a manager-only correction.
    if job_status == "closed" and principal.role != "manager":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "the job is closed — its evidence is frozen")
    response = await service.request_upload(job_id=job_id, body=body, created_by=principal.tech_id)
    await session.commit()
    return response


@router.post(
    "/{media_id}/complete",
    response_model=MediaItem,
    summary="Mark a media row as uploaded after the phone PUT succeeded",
)
async def complete_upload(
    job_id: str,
    media_id: UUID,
    body: MediaCompleteRequest,
    service: ServiceDep,
    session: SessionDep,
) -> MediaItem:
    try:
        item = await service.complete_upload(
            job_id=job_id, media_id=media_id, size_bytes=body.size_bytes
        )
    except MediaNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except MediaTooLargeError as e:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(e)) from e
    await session.commit()
    return item


@router.get(
    "",
    response_model=MediaList,
    summary="List a job's media, grouped by phase",
)
async def list_media(job_id: str, service: ServiceDep) -> MediaList:
    return await service.list_for_job(job_id=job_id)


@router.delete(
    "/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a media row + its storage object",
)
async def delete_media(
    job_id: str,
    media_id: UUID,
    service: ServiceDep,
    session: SessionDep,
    principal: CurrentPrincipal,
    jobs: JobsServiceDep,
) -> Response:
    job_status = await jobs.status_by_token(token=job_id, shop_id=DEFAULT_SHOP_ID)
    try:
        await service.delete(
            job_id=job_id,
            media_id=media_id,
            requested_by=principal.tech_id,
            is_manager=principal.role == "manager",
            job_open=job_status != "closed",
        )
    except MediaNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except MediaForbiddenError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e)) from e
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
