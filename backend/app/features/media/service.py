"""Media slice — business logic.

Orchestrates the repository (DB) and the storage client (Cloudflare R2). This
is the **public surface** for other slices: never reach past `MediaService`
from another feature.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import UUID, uuid4

from app.core.storage import DEFAULT_UPLOAD_TTL, StorageClient
from app.features.media.models import JobMedia, MediaStatus
from app.features.media.repository import MediaRepository
from app.features.media.schemas import (
    MediaItem,
    MediaList,
    MediaUploadRequest,
    MediaUploadResponse,
)

logger = logging.getLogger(__name__)

# Fallback ceiling if the caller doesn't pass one (the router passes the value
# from settings.r2_max_upload_bytes).
DEFAULT_MAX_UPLOAD_BYTES = 30 * 1024 * 1024


class MediaNotFoundError(LookupError):
    """Raised when a media row is not found for the given job."""


class MediaTooLargeError(ValueError):
    """Raised when a finalized upload exceeds the configured size ceiling."""


class MediaService:
    def __init__(
        self,
        repo: MediaRepository,
        storage: StorageClient,
        max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ) -> None:
        self._repo = repo
        self._storage = storage
        self._max_upload_bytes = max_upload_bytes

    # ── Commands ────────────────────────────────────────────────────────
    async def request_upload(self, *, job_id: str, body: MediaUploadRequest) -> MediaUploadResponse:
        """Reserve a media row and mint a signed R2 upload URL."""
        media_uuid = uuid4()
        ext = PurePosixPath(body.filename).suffix.lstrip(".").lower() or _default_ext(body.type)
        storage_path = f"{job_id}/{body.phase}/{media_uuid}.{ext}"

        media = await self._repo.create(
            job_id=job_id,
            phase=body.phase,
            type=body.type,
            filename=body.filename,
            storage_path=storage_path,
            content_type=body.content_type,
        )

        signed = self._storage.mint_upload_url(storage_path)
        return MediaUploadResponse(
            media_id=media.id,
            signed_url=signed.signed_url,
            storage_path=storage_path,
            expires_in=signed.expires_in or DEFAULT_UPLOAD_TTL,
        )

    async def complete_upload(
        self, *, job_id: str, media_id: UUID, size_bytes: int | None
    ) -> MediaItem:
        """Flip a row to `uploaded` after the phone PUT to R2 succeeded.

        A pre-signed PUT can't cap size server-side, so this is where we
        enforce it: an oversized upload is purged from storage, its pending
        row deleted, and the call rejected.
        """
        media = await self._load(job_id, media_id)

        if size_bytes is not None and size_bytes > self._max_upload_bytes:
            try:
                self._storage.delete(media.storage_path)
            except Exception:  # noqa: BLE001 — best-effort purge of the rejected object
                logger.warning(
                    "failed to purge oversized object %s", media.storage_path, exc_info=True
                )
            await self._repo.delete(media)
            raise MediaTooLargeError(
                f"upload {size_bytes} bytes exceeds limit {self._max_upload_bytes}"
            )

        await self._repo.mark_uploaded(
            media,
            size_bytes=size_bytes,
            uploaded_at=datetime.now(UTC),
        )
        return self._to_item(media)

    async def delete(self, *, job_id: str, media_id: UUID) -> None:
        """Remove the storage object then the DB row.

        Storage delete is best-effort: if the object is already gone we treat
        it as success and continue with the DB delete so the row never becomes
        a tombstone pointing at nothing.
        """
        media = await self._load(job_id, media_id)
        try:
            self._storage.delete(media.storage_path)
        except Exception:  # noqa: BLE001 — idempotent cleanup
            logger.warning(
                "storage delete failed for %s; proceeding with DB delete",
                media.storage_path,
                exc_info=True,
            )
        await self._repo.delete(media)

    # ── Queries ─────────────────────────────────────────────────────────
    async def list_for_job(self, *, job_id: str) -> MediaList:
        rows = await self._repo.list_for_job(job_id)
        before: list[MediaItem] = []
        after: list[MediaItem] = []
        for m in rows:
            item = self._to_item(m)
            (before if m.phase == "before" else after).append(item)
        return MediaList(before=before, after=after)

    # ── Internals ───────────────────────────────────────────────────────
    async def _load(self, job_id: str, media_id: UUID) -> JobMedia:
        media = await self._repo.get(media_id)
        if media is None or media.job_id != job_id:
            raise MediaNotFoundError(f"media {media_id} not found for job {job_id}")
        return media

    def _to_item(self, media: JobMedia) -> MediaItem:
        playback: str | None = None
        if media.status == MediaStatus.UPLOADED.value:
            playback = self._storage.mint_playback_url(media.storage_path) or None
        return MediaItem(
            id=media.id,
            job_id=media.job_id,
            phase=media.phase,  # type: ignore[arg-type]
            type=media.type,  # type: ignore[arg-type]
            filename=media.filename,
            storage_path=media.storage_path,
            content_type=media.content_type,
            size_bytes=media.size_bytes,
            status=media.status,  # type: ignore[arg-type]
            created_at=media.created_at,
            uploaded_at=media.uploaded_at,
            playback_url=playback,
        )


def _default_ext(media_type: str) -> str:
    return "mp4" if media_type == "video" else "jpg"
