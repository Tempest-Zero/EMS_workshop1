"""ORM model for the `job_media` table.

A row represents one captured before/after artefact for a job: the storage
path inside the Supabase bucket, what type it is, and whether the upload has
been finalized. Status flips from `pending` → `uploaded` when the mobile app
calls the `/complete` endpoint after PUTting the bytes via the signed URL.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Phase(StrEnum):
    BEFORE = "before"
    AFTER = "after"
    REMARK = "remark"  # voice note on the completion form
    CLOSING = "closing"  # required closing video on closure (Phase 3)
    CONDITION = "condition"  # W9/W12: pickup-delivery condition photos
    APPROVAL = "approval"  # W12: quote-photo / voice-consent artefacts


class MediaType(StrEnum):
    VIDEO = "video"
    PHOTO = "photo"
    AUDIO = "audio"


class MediaStatus(StrEnum):
    PENDING = "pending"
    UPLOADED = "uploaded"


class JobMedia(Base):
    __tablename__ = "job_media"
    __table_args__ = (
        CheckConstraint(
            "phase IN ('before', 'after', 'remark', 'closing', 'condition', 'approval')",
            name="job_media_phase_check",
        ),
        CheckConstraint("type IN ('video', 'photo', 'audio')", name="job_media_type_check"),
        CheckConstraint("status IN ('pending', 'uploaded')", name="job_media_status_check"),
        # Declared here so it matches migration 0001 (otherwise `alembic check`
        # reports drift). `job_id` gets its index from `index=True` below.
        Index("ix_job_media_status", "status"),
        Index("ix_job_media_job_uuid", "job_uuid"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    # The operational key: the job's human-facing token, keyed end-to-end (API
    # path + R2 storage paths). Kept as-is — the app writes/reads media by token.
    job_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # W12: the resolved, enforced link to the job (token → job.id). NULL for the
    # few rows whose token matches no job (legacy/demo). Analytics + integrity
    # join on this; the app is unaffected.
    job_uuid: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=True
    )
    phase: Mapped[str] = mapped_column(String(16), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    # Who uploaded it (tech id from the JWT). NULL on rows from before this
    # column existed — the delete policy grandfathers those.
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    # W12: cheap corpus metadata for audio/video (NULL for photos / older rows).
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    uploaded_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
