"""ORM model for the ``customer_message`` table — the Cloud API sender's
delivery bookkeeping.

One row per *automated* WhatsApp message decision, at most one per
``(job, kind)``: the unique constraint IS the idempotency guard, so an outbox
replay (a mobile completion resubmit, a dispatcher restart) can never
double-send a charges message. Manual click-to-chat sends are deliberately NOT
rows here — they live on the job timeline (``job_event kind='bill'``), because
the phone owns that send and the server only witnesses it.

Status lifecycle: ``pending`` (row claimed, API call in flight) → ``sent``
(Meta accepted, ``provider_message_id`` set) → ``delivered``/``read`` (webhook
status updates) — or ``failed`` (API/network error, ``error`` says why) /
``suppressed`` (no consent or no addressable phone at decision time; recorded
so the decision is auditable and permanent — a late opt-in must not fire a
stale message).
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

# The one place the automated message vocabulary lives (the annex's "read from
# one constant" seam). Extending it = extend the CHECK in a migration too.
MESSAGE_KINDS = ("intake_ack", "bill", "ready")
MESSAGE_STATUSES = ("pending", "sent", "delivered", "read", "failed", "suppressed")


class CustomerMessage(Base):
    __tablename__ = "customer_message"
    __table_args__ = (
        UniqueConstraint("job_id", "kind", name="uq_customer_message_job_kind"),
        CheckConstraint(
            "kind IN ('intake_ack', 'bill', 'ready')", name="customer_message_kind_check"
        ),
        CheckConstraint(
            "status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'suppressed')",
            name="customer_message_status_check",
        ),
        # The webhook resolves status updates by Meta's message id.
        Index(
            "ix_customer_message_provider",
            "provider_message_id",
            postgresql_where=text("provider_message_id IS NOT NULL"),
        ),
    )

    id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    shop_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("shop.id"), nullable=False, server_default=text("'default'")
    )
    job_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("job.id"), nullable=False)
    # NULL when the job never linked a customer (consent then can't exist, so
    # such a row can only be 'suppressed').
    customer_id: Mapped[UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("customer.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    to_phone_e164: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # The rendered fallback text (what the template says, minimum-info only) —
    # the audit copy of what the customer was told. Empty for suppressed rows.
    body: Mapped[str] = mapped_column(String(1024), nullable=False, server_default=text("''"))
    template_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=text("'pending'")
    )
    # Meta's wamid — the key webhook status updates arrive under.
    provider_message_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
