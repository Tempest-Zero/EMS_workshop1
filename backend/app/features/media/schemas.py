"""Pydantic request/response models for the media slice.

Pydantic owns input validation — by the time a service method runs, fields
are already in their declared types.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# before/after = repair evidence; condition = arrival condition snaps (gallery
# family, F8); remark = the completion voice note (audio); intake/approval =
# the intake problem + estimate voice notes (audio — referenced from their
# owning forms, never the gallery); closing = the required closing video on
# job closure (Phase 3). The DB check (0036) is the same set.
Phase = Literal["before", "after", "remark", "closing", "condition", "approval", "intake"]
MediaType = Literal["video", "photo", "audio"]
MediaStatus = Literal["pending", "uploaded"]

# What MIME family each media type may declare. The signed PUT is bound to the
# declared content type, so this is the one place junk MIME gets rejected.
_MIME_FAMILY: dict[str, str] = {"video": "video/", "photo": "image/", "audio": "audio/"}


class MediaUploadRequest(BaseModel):
    """Body for `POST /api/jobs/{job_id}/media`."""

    phase: Phase
    type: MediaType
    filename: str = Field(..., min_length=1, max_length=512)
    content_type: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def _content_type_matches_media_type(self) -> MediaUploadRequest:
        if self.content_type is not None:
            family = _MIME_FAMILY[self.type]
            if not self.content_type.lower().startswith(family):
                raise ValueError(
                    f"content_type {self.content_type!r} does not match media type "
                    f"{self.type!r} (expected {family}*)"
                )
        return self


class MediaUploadResponse(BaseModel):
    """Returned to the mobile app so it can PUT bytes to R2 directly."""

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
    the closure video (Phase 3); ``condition`` is the arrival condition snaps
    (F8). ``remark``/``intake``/``approval`` audio is intentionally not
    surfaced here (each is played from its owning form, not the gallery)."""

    before: list[MediaItem]
    after: list[MediaItem]
    closing: list[MediaItem] = []
    condition: list[MediaItem] = []
