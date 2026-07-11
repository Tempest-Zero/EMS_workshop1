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
    repo.count_phase = AsyncMock(return_value=0)

    storage = MagicMock()
    storage.mint_upload_url = MagicMock(
        return_value=SignedUpload(
            signed_url="https://signed.example/up",
            token="tok",
            expires_in=600,
        )
    )
    storage.mint_playback_url = MagicMock(return_value="https://signed.example/play")
    # Default: HEAD can't read a size → service falls back to the client value.
    storage.head_size = MagicMock(return_value=None)
    storage.delete = MagicMock()

    # Pin an explicit ceiling so these tests don't ride on the production
    # default (which can change) — the oversized cases below assume 30 MB.
    yield MediaService(repo, storage, max_upload_bytes=30 * 1024 * 1024), repo, storage


async def test_count_phase_delegates_to_repo(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    svc, repo, _ = service
    repo.count_phase.return_value = 2
    assert await svc.count_phase(job_id="1052", phase="closing") == 2
    repo.count_phase.assert_awaited_once_with("1052", "closing")


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
    # The signed PUT is bound to the declared content type.
    storage.mint_upload_url.assert_called_once_with(
        kwargs["storage_path"], content_type="video/mp4"
    )
    assert resp.signed_url == "https://signed.example/up"


async def test_request_upload_defaults_content_type_for_signing(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    # No declared MIME → bind the media type's default so the URL still can't
    # carry arbitrary bytes (matches the app's PUT fallback header).
    svc, repo, storage = service
    repo.create.return_value = _media(type="audio", content_type=None)

    await svc.request_upload(
        job_id="job-1",
        body=MediaUploadRequest(phase="remark", type="audio", filename="note.m4a"),
    )

    assert repo.create.await_args.kwargs["content_type"] == "audio/mp4"
    assert storage.mint_upload_url.call_args.kwargs["content_type"] == "audio/mp4"


def test_upload_request_rejects_mismatched_content_type() -> None:
    with pytest.raises(ValueError, match="does not match media type"):
        MediaUploadRequest(phase="before", type="photo", filename="x.jpg", content_type="video/mp4")


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
        _media(phase="closing", type="video"),
        _media(phase="condition"),
        _media(phase="remark", type="audio"),  # not gallery media → excluded
        _media(phase="intake", type="audio"),  # not gallery media → excluded
        _media(phase="approval", type="audio"),  # not gallery media → excluded
    ]

    out = await svc.list_for_job(job_id="job-1")

    assert len(out.before) == 2
    assert len(out.after) == 1
    assert len(out.closing) == 1
    assert len(out.condition) == 1


def test_upload_request_accepts_new_phases() -> None:
    """The 0036 vocabulary: condition snaps + the intake/approval voice notes."""
    for phase, mtype in (("condition", "photo"), ("intake", "audio"), ("approval", "audio")):
        req = MediaUploadRequest.model_validate(
            {"phase": phase, "type": mtype, "filename": f"x-{phase}"}
        )
        assert req.phase == phase


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
    # Ceiling is pinned to 30 MB in the fixture; a 40 MB finalize must be rejected + purged.
    svc, repo, storage = service
    target = _media(storage_path="job-1/before/big.mp4")
    repo.get.return_value = target

    with pytest.raises(MediaTooLargeError):
        await svc.complete_upload(job_id="job-1", media_id=target.id, size_bytes=40 * 1024 * 1024)

    storage.delete.assert_called_once_with("job-1/before/big.mp4")
    repo.delete.assert_awaited_once_with(target)
    repo.mark_uploaded.assert_not_awaited()


async def test_complete_upload_enforces_real_size_over_client_report(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    # Client under-reports (10 bytes) but R2 says the object is 40 MB. The
    # real size must win, so the oversized upload is rejected + purged.
    svc, repo, storage = service
    target = _media(storage_path="job-1/before/liar.mp4")
    repo.get.return_value = target
    storage.head_size.return_value = 40 * 1024 * 1024

    with pytest.raises(MediaTooLargeError):
        await svc.complete_upload(job_id="job-1", media_id=target.id, size_bytes=10)

    storage.delete.assert_called_once_with("job-1/before/liar.mp4")
    repo.delete.assert_awaited_once_with(target)
    repo.mark_uploaded.assert_not_awaited()


async def test_complete_upload_stores_real_size_when_head_available(
    service: tuple[MediaService, MagicMock, MagicMock],
) -> None:
    # When the HEAD succeeds, the stored size is R2's number, not the client's.
    svc, repo, storage = service
    target = _media()
    repo.get.return_value = target
    storage.head_size.return_value = 2048

    async def _mark_uploaded(
        media: JobMedia, *, size_bytes: int | None, uploaded_at: datetime
    ) -> None:
        media.size_bytes = size_bytes

    repo.mark_uploaded.side_effect = _mark_uploaded

    item = await svc.complete_upload(job_id="job-1", media_id=target.id, size_bytes=999)

    assert item.size_bytes == 2048
    assert repo.mark_uploaded.await_args.kwargs["size_bytes"] == 2048
