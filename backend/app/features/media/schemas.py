"""Pydantic request/response models for the media slice.

Pydantic owns input validation — by the time a service method runs, fields
are already in their declared types.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# before/after = repair evidence; remark = voice note (audio); closing = the
# required closing video on job closure (Phase 3).
Phase = Literal["before", "after", "remark", "closing"]
MediaType = Literal["video", "photo", "audio"]
MediaStatus = Literal["pending", "uploaded"]


class MediaUploadRequest(BaseModel):
    """Body for `POST /api/jobs/{job_id}/media`."""

    phase: Phase
    type: MediaType
    filename: str = Field(..., min_length=1, max_length=512)
    content_type: str | None = Field(default=None, max_length=128)


class MediaUploadResponse(BaseModel):
    """Returned to the mobile app so it can PUT bytes to Supabase directly."""

    media_id: UUID
    signed_url: str
    storage_path: str
    expires_in: int


class MediaCompleteRequest(BaseModel):
    """Body for `POST /api/jobs/{job_id}/media/{media_id}/complete`."""

    size_bytes: int | None = Field(default=None, ge=0)


class MediaItem(BaseModel):
    """Public read model of a single media row."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    job_id: str
    phase: Phase
    type: MediaType
    filename: str
    storage_path: str
    content_type: str | None = None
    size_bytes: int | None = None
    status: MediaStatus
    created_at: datetime
    uploaded_at: datetime | None = None
    # Present (signed) once status == "uploaded". Refreshed by re-fetching list.
    playback_url: str | None = None


class MediaList(BaseModel):
    """Grouped media response for `GET /api/jobs/{job_id}/media`. ``closing`` is
    the closure video (Phase 3); ``remark`` audio is intentionally not surfaced
    here (it's played from the completion form, not the evidence gallery)."""

    before: list[MediaItem]
    after: list[MediaItem]
    closing: list[MediaItem] = []
