"""Data access for `job_media`. Stays thin — service layer owns business logic."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.media.models import JobMedia, MediaStatus


class MediaRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        *,
        job_id: str,
        phase: str,
        type: str,
        filename: str,
        storage_path: str,
        content_type: str | None,
    ) -> JobMedia:
        media = JobMedia(
            job_id=job_id,
            phase=phase,
            type=type,
            filename=filename,
            storage_path=storage_path,
            content_type=content_type,
        )
        self._session.add(media)
        await self._session.flush()  # populates id + server defaults
        await self._session.refresh(media)
        return media

    async def get(self, media_id: UUID) -> JobMedia | None:
        return await self._session.get(JobMedia, media_id)

    async def list_for_job(self, job_id: str) -> list[JobMedia]:
        stmt = select(JobMedia).where(JobMedia.job_id == job_id).order_by(JobMedia.created_at.asc())
        result = await self._session.execute(stmt)
        return list(result.scalars())

    async def count_phase(self, job_id: str, phase: str) -> int:
        """How many media rows a job has for a phase, regardless of upload status
        (a *pending* row counts — the closing-video gate is offline-tolerant)."""
        stmt = (
            select(func.count())
            .select_from(JobMedia)
            .where(JobMedia.job_id == job_id, JobMedia.phase == phase)
        )
        result = await self._session.execute(stmt)
        return int(result.scalar_one())

    async def phase_counts(self, job_ids: list[str], phase: str) -> dict[str, tuple[int, int]]:
        """Per-job ``(total, uploaded)`` media counts for a phase. Jobs with no
        rows at all are absent from the map."""
        if not job_ids:
            return {}
        uploaded = func.sum(case((JobMedia.status == MediaStatus.UPLOADED.value, 1), else_=0))
        stmt = (
            select(JobMedia.job_id, func.count(), uploaded)
            .where(JobMedia.job_id.in_(job_ids), JobMedia.phase == phase)
            .group_by(JobMedia.job_id)
        )
        result = await self._session.execute(stmt)
        return {str(job_id): (int(total), int(up or 0)) for job_id, total, up in result.all()}

    async def mark_uploaded(
        self,
        media: JobMedia,
        *,
        size_bytes: int | None,
        uploaded_at: datetime,
    ) -> None:
        media.status = MediaStatus.UPLOADED.value
        media.size_bytes = size_bytes
        media.uploaded_at = uploaded_at
        await self._session.flush()

    async def delete(self, media: JobMedia) -> None:
        await self._session.delete(media)
        await self._session.flush()
