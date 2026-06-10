"""The evidence delete policy: manager always; a technician only their own
media while the job is open; closed jobs are frozen. Repo + storage mocked."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.media.models import JobMedia
from app.features.media.service import MediaForbiddenError, MediaService


def _media(created_by: str | None) -> JobMedia:
    media = JobMedia(
        job_id="1060",
        phase="after",
        type="photo",
        filename="x.jpg",
        storage_path="1060/after/x.jpg",
        created_by=created_by,
    )
    media.id = uuid4()
    return media


@pytest.fixture
def svc() -> tuple[MediaService, MagicMock, MagicMock]:
    repo = MagicMock()
    repo.delete = AsyncMock()
    storage = MagicMock()
    return MediaService(repo, storage), repo, storage


async def _delete(
    svc: tuple[MediaService, MagicMock, MagicMock],
    media: JobMedia,
    *,
    requested_by: str,
    is_manager: bool,
    job_open: bool,
) -> None:
    service, repo, _ = svc
    repo.get = AsyncMock(return_value=media)
    await service.delete(
        job_id="1060",
        media_id=media.id,
        requested_by=requested_by,
        is_manager=is_manager,
        job_open=job_open,
    )


async def test_own_media_while_open_is_deletable(
    svc: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    _, repo, _ = svc
    await _delete(svc, _media("t2"), requested_by="t2", is_manager=False, job_open=True)
    repo.delete.assert_awaited_once()


async def test_someone_elses_media_is_not(
    svc: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    _, repo, _ = svc
    with pytest.raises(MediaForbiddenError, match="technician who captured"):
        await _delete(svc, _media("t2"), requested_by="t3", is_manager=False, job_open=True)
    repo.delete.assert_not_awaited()


async def test_closed_job_evidence_is_frozen_for_technicians(
    svc: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    _, repo, _ = svc
    with pytest.raises(MediaForbiddenError, match="frozen"):
        await _delete(svc, _media("t2"), requested_by="t2", is_manager=False, job_open=False)
    repo.delete.assert_not_awaited()


async def test_manager_override_works_even_after_close(
    svc: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    _, repo, _ = svc
    await _delete(svc, _media("t2"), requested_by="m1", is_manager=True, job_open=False)
    repo.delete.assert_awaited_once()


async def test_legacy_unowned_rows_are_grandfathered_while_open(
    svc: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    # Rows from before created_by existed: any tech may retake them while the
    # job is open (old installed apps must not break).
    _, repo, _ = svc
    await _delete(svc, _media(None), requested_by="t4", is_manager=False, job_open=True)
    repo.delete.assert_awaited_once()
