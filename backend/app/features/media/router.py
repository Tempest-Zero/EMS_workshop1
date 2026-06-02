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

from app.core.config import settings
from app.core.db import get_session
from app.core.storage import StorageClient, get_storage
from app.features.media.repository import MediaRepository
from app.features.media.schemas import (
    MediaCompleteRequest,
    MediaItem,
    MediaList,
    MediaUploadRequest,
    MediaUploadResponse,
)
from app.features.media.service import (
    MediaNotFoundError,
    MediaService,
    MediaTooLargeError,
)

router = APIRouter(prefix="/jobs/{job_id}/media", tags=["media"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
StorageDep = Annotated[StorageClient, Depends(get_storage)]


def get_service(session: SessionDep, storage: StorageDep) -> MediaService:
    return MediaService(MediaRepository(session), storage, settings.r2_max_upload_bytes)


ServiceDep = Annotated[MediaService, Depends(get_service)]


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
) -> MediaUploadResponse:
    response = await service.request_upload(job_id=job_id, body=body)
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
) -> Response:
    try:
        await service.delete(job_id=job_id, media_id=media_id)
    except MediaNotFoundError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
