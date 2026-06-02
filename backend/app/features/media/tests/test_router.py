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
from app.features.media.router import get_service
from app.features.media.schemas import MediaList, MediaUploadResponse
from app.features.media.service import MediaNotFoundError, MediaService
from app.main import app


@pytest.fixture
def fake_service() -> AsyncMock:
    return AsyncMock(spec=MediaService)


@pytest.fixture
def fake_session() -> AsyncMock:
    session = AsyncMock()
    session.commit = AsyncMock()
    return session


@pytest_asyncio.fixture
async def client(fake_service: AsyncMock, fake_session: AsyncMock) -> AsyncIterator[AsyncClient]:
    app.dependency_overrides[get_service] = lambda: cast(MediaService, fake_service)
    app.dependency_overrides[get_session] = lambda: fake_session
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
    assert response.json() == {"before": [], "after": []}


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
