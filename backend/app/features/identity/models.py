"""ORM model for the `technician` table — the workshop roster + login identity.

The string PK is the stable ``tech_id`` slug (``t1`` … ``t5``) that the
attendance and media slices already store, so existing data keeps referring to
real rows. ``role`` is recorded for display and future authorization, but v1
enforces no per-role gating (any logged-in user can do everything).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Technician(Base):
    __tablename__ = "technician"
    __table_args__ = (CheckConstraint("role IN ('tech', 'manager')", name="technician_role_check"),)

    # Stable slug PK (e.g. "t1"), matching the ids attendance/media already use.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    specialty: Mapped[str | None] = mapped_column(String(128), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Tailwind color class carried over from the web mock's avatars.
    avatar: Mapped[str | None] = mapped_column(String(32), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, server_default=text("'tech'"))
    # PBKDF2 string from security.hash_pin (never the raw PIN).
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
