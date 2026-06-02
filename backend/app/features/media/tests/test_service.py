"""Unit tests for `MediaService`. Repository + storage are mocked so these run
without a real database or Supabase connection."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.core.storage import SignedUpload
from app.features.media.models import JobMedia, MediaStatus
from app.features.media.schemas import MediaUploadRequest
from app.features.media.service import MediaNotFoundError, MediaService, MediaTooLargeError


def _media(**overrides: object) -> JobMedia:
    """Build an in-memory JobMedia without going through SQLAlchemy defaults."""
    media = JobMedia(
        id=uuid4(),
        job_id="job-1",
        phase="before",
        type="video",
        filename="clip.mp4",
        storage_path="job-1/before/abc.mp4",
        content_type="video/mp4",
        size_bytes=None,
        status=MediaStatus.PENDING.value,
        uploaded_by=None,
        created_at=datetime(2026, 6, 2, 12, 0, tzinfo=UTC),
        uploaded_at=None,
    )
    for k, v in overrides.items():
        setattr(media, k, v)
    return media


@pytest.fixture
def service() -> Iterator[tuple[MediaService, MagicMock, MagicMock]]:
    repo = MagicMock()
    repo.create = AsyncMock()
    repo.get = AsyncMock()
    repo.list_for_job = AsyncMock()
    repo.mark_uploaded = AsyncMock()
    repo.delete = AsyncMock()

    storage = MagicMock()
    storage.mint_upload_url = MagicMock(
        return_value=SignedUpload(
            signed_url="https://signed.example/up",
            token="tok",
            expires_in=600,
        )
    )
    storage.mint_playback_url = MagicMock(return_value="https://signed.example/play")
    storage.delete = MagicMock()

    yield MediaService(repo, storage), repo, storage


async def test_request_upload_creates_row_and_mints_url(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, storage = service
    created = _media()
    repo.create.return_value = created

    resp = await svc.request_upload(
        job_id="job-1",
        body=MediaUploadRequest(
            phase="before", type="video", filename="vid.mp4", content_type="video/mp4"
        ),
    )

    repo.create.assert_awaited_once()
    kwargs = repo.create.await_args.kwargs
    assert kwargs["job_id"] == "job-1"
    assert kwargs["phase"] == "before"
    assert kwargs["storage_path"].startswith("job-1/before/")
    assert kwargs["storage_path"].endswith(".mp4")

    storage.mint_upload_url.assert_called_once()
    assert resp.media_id == created.id
    assert resp.signed_url == "https://signed.example/up"
    assert resp.expires_in == 600


async def test_request_upload_default_extension_for_photo(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, _ = service
    repo.create.return_value = _media()

    await svc.request_upload(
        job_id="job-1",
        body=MediaUploadRequest(phase="after", type="photo", filename="no-ext"),
    )

    path = repo.create.await_args.kwargs["storage_path"]
    assert path.endswith(".jpg"), path


async def test_complete_upload_marks_uploaded_and_returns_playback(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, storage = service

    # Emulate repo flipping status in place when mark_uploaded is awaited.
    target = _media()
    repo.get.return_value = target

    async def _mark_uploaded(
        media: JobMedia, *, size_bytes: int | None, uploaded_at: datetime
    ) -> None:
        media.status = MediaStatus.UPLOADED.value
        media.size_bytes = size_bytes
        media.uploaded_at = uploaded_at

    repo.mark_uploaded.side_effect = _mark_uploaded

    item = await svc.complete_upload(job_id="job-1", media_id=target.id, size_bytes=12345)

    repo.mark_uploaded.assert_awaited_once()
    storage.mint_playback_url.assert_called_once_with(target.storage_path)
    assert item.status == "uploaded"
    assert item.size_bytes == 12345
    assert item.playback_url == "https://signed.example/play"


async def test_complete_upload_wrong_job_raises_not_found(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, _ = service
    repo.get.return_value = _media(job_id="other-job")

    with pytest.raises(MediaNotFoundError):
        await svc.complete_upload(job_id="job-1", media_id=uuid4(), size_bytes=None)


async def test_complete_upload_missing_raises_not_found(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, _ = service
    repo.get.return_value = None

    with pytest.raises(MediaNotFoundError):
        await svc.complete_upload(job_id="job-1", media_id=uuid4(), size_bytes=None)


async def test_delete_removes_storage_then_db(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, storage = service
    media = _media(storage_path="path/x.mp4")
    repo.get.return_value = media

    await svc.delete(job_id="job-1", media_id=media.id)

    storage.delete.assert_called_once_with("path/x.mp4")
    repo.delete.assert_awaited_once_with(media)


async def test_delete_swallows_storage_failure_to_avoid_orphan_rows(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, storage = service
    media = _media()
    repo.get.return_value = media
    storage.delete.side_effect = RuntimeError("gone already")

    # Should not raise — DB row still gets cleaned up.
    await svc.delete(job_id="job-1", media_id=media.id)
    repo.delete.assert_awaited_once_with(media)


async def test_list_for_job_groups_by_phase(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, _ = service
    repo.list_for_job.return_value = [
        _media(phase="before"),
        _media(phase="after"),
        _media(phase="before"),
    ]

    out = await svc.list_for_job(job_id="job-1")

    assert len(out.before) == 2
    assert len(out.after) == 1


async def test_list_for_job_does_not_mint_playback_for_pending(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, storage = service
    repo.list_for_job.return_value = [_media()]  # status=pending

    out = await svc.list_for_job(job_id="job-1")

    assert out.before[0].playback_url is None
    storage.mint_playback_url.assert_not_called()


async def test_complete_upload_rejects_oversized(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    # Default ceiling is 30 MB; a 40 MB finalize must be rejected + purged.
    svc, repo, storage = service
    target = _media(storage_path="job-1/before/big.mp4")
    repo.get.return_value = target

    with pytest.raises(MediaTooLargeError):
        await svc.complete_upload(job_id="job-1", media_id=target.id, size_bytes=40 * 1024 * 1024)

    storage.delete.assert_called_once_with("job-1/before/big.mp4")
    repo.delete.assert_awaited_once_with(target)
    repo.mark_uploaded.assert_not_awaited()
