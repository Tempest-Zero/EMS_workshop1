"""Media slice — dependency providers (the cross-slice construction surface).

Another slice that needs the media service (e.g. jobs' closing-video gate)
imports ``get_media_service`` from here instead of assembling
``MediaService(MediaRepository(...))`` itself — repositories and models stay
private to the slice; ``service.py`` + ``deps.py`` are the contract.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.storage import StorageClient, get_storage
from app.features.media.repository import MediaRepository
from app.features.media.service import MediaService


def get_media_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    storage: Annotated[StorageClient, Depends(get_storage)],
) -> MediaService:
    return MediaService(MediaRepository(session), storage, settings.r2_max_upload_bytes)


MediaServiceDep = Annotated[MediaService, Depends(get_media_service)]
