"""Router-level tests. Overrides `get_service` + `get_session` with fakes so
no DB or Supabase round-trip happens."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.db import get_session
from app.features.identity.deps import get_current_principal
from app.features.identity.schemas import Principal
from app.features.jobs.deps import get_jobs_service
from app.features.jobs.service import JobService
from app.features.media.deps import get_media_service as get_service
from app.features.media.schemas import MediaList, MediaUploadResponse
from app.features.media.service import MediaNotFoundError, MediaService, MediaTooLargeError
from app.main import app

_FAKE_PRINCIPAL = Principal(tech_id="t1", role="manager", name="Test Manager")


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=MediaService)


@pytest.fixture
def fake_jobs() -> AsyncMock:
    # request_upload checks the job exists (and isn't closed) via the jobs
    # slice; default every test to a live open job.
    jobs = AsyncMock(spec=JobService)
    jobs.status_by_token.return_value = "open"
    return jobs


@pytest.fixture
def fake_session() -> AsyncMock:
    session = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest_asyncio.fixture
async def client(
    fake_service: AsyncMock, fake_session: AsyncMock, fake_jobs: AsyncMock
) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(MediaService, fake_service)
    app.dependency_overrides[get_session] = lambda: fake_session
    app.dependency_overrides[get_jobs_service] = lambda: cast(JobService, fake_jobs)
    app.dependency_overrides[get_current_principal] = lambda: _FAKE_PRINCIPAL
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


async def test_post_media_returns_signed_url(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    media_id = uuid4()
    fake_service.request_upload.return_value = MediaUploadResponse(
        media_id=media_id,
        signed_url="https://signed.example/up",
        storage_path="job-1/before/x.mp4",
        expires_in=600,
    )

    response = await client.post(
        "/api/jobs/job-1/media",
        json={"phase": "before", "type": "video", "filename": "v.mp4"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["signed_url"] == "https://signed.example/up"
    assert body["media_id"] == str(media_id)
    fake_session.commit.assert_awaited()


async def test_post_media_rejects_invalid_phase(client: AsyncClient) -> None:
    response = await client.post(
        "/api/jobs/job-1/media",
        json={"phase": "sideways", "type": "video", "filename": "v.mp4"},
    )
    assert response.status_code == 422


async def test_post_media_rejects_mismatched_content_type(client: AsyncClient) -> None:
    # Declared MIME must match the media type family (signed PUTs bind to it).
    response = await client.post(
        "/api/jobs/job-1/media",
        json={"phase": "before", "type": "photo", "filename": "x.jpg", "content_type": "video/mp4"},
    )
    assert response.status_code == 422


async def test_post_media_unknown_job_returns_404(
    client: AsyncClient, fake_jobs: AsyncMock, fake_service: AsyncMock
) -> None:
    # Evidence rows must hang off a real job — otherwise any authenticated
    # caller can mint unlimited signed PUT URLs under arbitrary key prefixes.
    fake_jobs.status_by_token.return_value = None
    response = await client.post(
        "/api/jobs/no-such-job/media",
        json={"phase": "before", "type": "photo", "filename": "x.jpg"},
    )
    assert response.status_code == 404
    fake_service.request_upload.assert_not_awaited()


async def test_post_media_closed_job_forbidden_for_tech(
    client: AsyncClient, fake_jobs: AsyncMock, fake_service: AsyncMock
) -> None:
    # Evidence freezes at close (mirrors the delete policy).
    fake_jobs.status_by_token.return_value = "closed"
    app.dependency_overrides[get_current_principal] = lambda: Principal(
        tech_id="t5", role="tech", name="Imran"
    )
    response = await client.post(
        "/api/jobs/1051/media",
        json={"phase": "after", "type": "photo", "filename": "x.jpg"},
    )
    assert response.status_code == 403
    fake_service.request_upload.assert_not_awaited()


async def test_post_media_closed_job_allowed_for_manager(
    client: AsyncClient, fake_jobs: AsyncMock, fake_service: AsyncMock
) -> None:
    fake_jobs.status_by_token.return_value = "closed"
    fake_service.request_upload.return_value = MediaUploadResponse(
        media_id=uuid4(),
        signed_url="https://signed.example/up",
        storage_path="1051/after/x.jpg",
        expires_in=600,
    )
    response = await client.post(
        "/api/jobs/1051/media",
        json={"phase": "after", "type": "photo", "filename": "x.jpg"},
    )
    assert response.status_code == 201


async def test_complete_unknown_returns_404(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.complete_upload.side_effect = MediaNotFoundError("nope")
    response = await client.post(
        f"/api/jobs/job-1/media/{uuid4()}/complete",
        json={"size_bytes": 1234},
    )
    assert response.status_code == 404


async def test_list_returns_grouped(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.list_for_job.return_value = MediaList(before=[], after=[])
    response = await client.get("/api/jobs/job-1/media")
    assert response.status_code == 200
    assert response.json() == {"before": [], "after": [], "closing": [], "condition": []}


async def test_delete_returns_204(
    client: AsyncClient, fake_service: AsyncMock, fake_session: AsyncMock
) -> None:
    fake_service.delete.return_value = None
    response = await client.delete(f"/api/jobs/job-1/media/{uuid4()}")
    assert response.status_code == 204
    fake_session.commit.assert_awaited()


async def test_delete_unknown_returns_404(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.delete.side_effect = MediaNotFoundError("nope")
    response = await client.delete(f"/api/jobs/job-1/media/{uuid4()}")
    assert response.status_code == 404


async def test_complete_too_large_returns_413(client: AsyncClient, fake_service: AsyncMock) -> None:
    fake_service.complete_upload.side_effect = MediaTooLargeError("too big")
    response = await client.post(
        f"/api/jobs/job-1/media/{uuid4()}/complete",
        json={"size_bytes": 99_999_999},
    )
    assert response.status_code == 413


async def test_media_requires_auth(client: AsyncClient) -> None:
    # Drop the auth override so the real guard runs: no token → 401.
    app.dependency_overrides.pop(get_current_principal, None)
    response = await client.get("/api/jobs/job-1/media")
    assert response.status_code == 401
