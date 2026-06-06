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

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, String, text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Phase(StrEnum):
    BEFORE = "before"
    AFTER = "after"


class MediaType(StrEnum):
    VIDEO = "video"
    PHOTO = "photo"


class MediaStatus(StrEnum):
    PENDING = "pending"
    UPLOADED = "uploaded"


class JobMedia(Base):
    __tablename__ = "job_media"
    __table_args__ = (
        CheckConstraint("phase IN ('before', 'after')", name="job_media_phase_check"),
        CheckConstraint("type IN ('video', 'photo')", name="job_media_type_check"),
        CheckConstraint("status IN ('pending', 'uploaded')", name="job_media_status_check"),
        # Declared here so it matches migration 0001 (otherwise `alembic check`
        # reports drift). `job_id` gets its index from `index=True` below.
        Index("ix_job_media_status", "status"),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    job_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    phase: Mapped[str] = mapped_column(String(16), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    uploaded_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
