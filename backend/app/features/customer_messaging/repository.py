"""Data access for the customer_messaging slice. Slice-private — other slices
go through ``service.py``/``deps.py``."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.customer_messaging.models import CustomerMessage


class CustomerMessageRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get_by_job_kind(self, job_id: UUID, kind: str) -> CustomerMessage | None:
        stmt = select(CustomerMessage).where(
            CustomerMessage.job_id == job_id, CustomerMessage.kind == kind
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_by_provider_id(self, provider_message_id: str) -> CustomerMessage | None:
        stmt = select(CustomerMessage).where(
            CustomerMessage.provider_message_id == provider_message_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def add(self, message: CustomerMessage) -> CustomerMessage:
        self.session.add(message)
        await self.session.flush()
        return message

    async def rollback(self) -> None:
        await self.session.rollback()
