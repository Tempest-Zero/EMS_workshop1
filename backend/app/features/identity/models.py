"""ORM model for the `technician` table — the workshop roster + login identity.

The string PK is the stable ``tech_id`` slug (``t1`` … ``t5``) that the
attendance and media slices already store, so existing data keeps referring to
real rows. ``role`` is **enforced**: ``identity.deps.CurrentManager`` gates the
manager-only endpoints (attendance board/grid/payroll/adjustments, session
revoke, …), so a technician token gets 403 there. Shared actions (job
assign/claim — dual-assignment by design) stay open to any authenticated user.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, text
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

    # ── Login throttle state (migration 0013) ───────────────────────────────
    # Consecutive failed logins; only reset on a successful login, so escalation
    # persists across an expired lock. ``locked_until`` (when set in the future)
    # blocks login → 429. Self-healing: the lock decays, it never hard-locks
    # (there is one manager account — a permanent lock would be a DoS gift).
    # `default=0` alongside the server default so direct `session.add(...)`
    # inserts don't need to spell these out. (Both apply at INSERT — a fresh
    # in-memory instance still reads None, which the service tolerates.)
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Bumped to invalidate every live JWT for this tech (lost-phone kill switch).
    # The token carries this as a ``ver`` claim; a missing claim is treated as 0,
    # so tokens issued before 0013 stay valid until a deliberate bump.
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
