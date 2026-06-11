"""End-to-end media tests against a **real Postgres** — exercises the media
slice's real SQL lifecycle (insert → list → mark uploaded → delete). Storage is
faked, so no R2 round-trip is needed."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


async def _create_job(app_client: AsyncClient, headers: dict[str, str]) -> str:
    """Media rows must hang off a real job (keyed by its token) since the
    upload endpoint validates existence."""
    resp = await app_client.post(
        "/api/jobs",
        json={"customer_name": "Media Test", "appliance_type": "Fridge", "problem": "no cooling"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return str(resp.json()["token"])


async def test_media_lifecycle(app_client: AsyncClient, auth_headers: dict[str, str]) -> None:
    job = await _create_job(app_client, auth_headers)

    # Reserve a row + mint a (fake) signed upload URL — real INSERT.
    created = await app_client.post(
        f"/api/jobs/{job}/media",
        json={"phase": "before", "type": "photo", "filename": "x.jpg"},
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text
    media_id = created.json()["media_id"]
    assert created.json()["signed_url"].startswith("https://fake/upload/")

    # List groups by phase — real SELECT.
    listed = await app_client.get(f"/api/jobs/{job}/media", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["before"]) == 1
    assert listed.json()["before"][0]["status"] == "pending"

    # Finalize — real UPDATE; playback URL appears.
    completed = await app_client.post(
        f"/api/jobs/{job}/media/{media_id}/complete",
        json={"size_bytes": 1000},
        headers=auth_headers,
    )
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "uploaded"
    assert completed.json()["playback_url"].startswith("https://fake/play/")

    # Delete — real DELETE; the list is empty again.
    deleted = await app_client.delete(f"/api/jobs/{job}/media/{media_id}", headers=auth_headers)
    assert deleted.status_code == 204, deleted.text
    listed_after = await app_client.get(f"/api/jobs/{job}/media", headers=auth_headers)
    assert listed_after.json()["before"] == []


async def test_media_accepts_audio_remark(
    app_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # The completion voice note is a media row: type=audio, phase=remark.
    # A 201 proves the DB CHECK constraints now allow them (migration 0009).
    job = await _create_job(app_client, auth_headers)
    created = await app_client.post(
        f"/api/jobs/{job}/media",
        json={
            "phase": "remark",
            "type": "audio",
            "filename": "note.m4a",
            "content_type": "audio/m4a",
        },
        headers=auth_headers,
    )
    assert created.status_code == 201, created.text


async def test_media_upload_rejects_unknown_job(
    app_client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    # No matching job token → no media row, no signed URL (storage-abuse guard).
    created = await app_client.post(
        "/api/jobs/999999/media",
        json={"phase": "before", "type": "photo", "filename": "x.jpg"},
        headers=auth_headers,
    )
    assert created.status_code == 404, created.text


async def test_media_requires_auth(app_client: AsyncClient) -> None:
    # No bearer token → the guard rejects it.
    resp = await app_client.get("/api/jobs/job-int-1/media")
    assert resp.status_code == 401, resp.text
