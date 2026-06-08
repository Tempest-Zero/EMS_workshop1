"""Notifications slice — push registry + delivery via the Expo push service.

Public surface for other slices (e.g. jobs calls ``notify_assignment`` when a
manager assigns a job). Delivery is **best-effort**: a push failure must never
break the action that triggered it, so callers wrap this in try/except and it
also swallows transport errors internally.
"""

from __future__ import annotations

import logging

import httpx

from app.features.notifications.repository import NotificationRepository

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class NotificationService:
    def __init__(self, repo: NotificationRepository) -> None:
        self._repo = repo

    async def register(self, *, tech_id: str, token: str, platform: str) -> None:
        await self._repo.upsert_token(tech_id=tech_id, token=token, platform=platform)

    async def notify_assignment(self, *, tech_id: str, job_token: int) -> None:
        """Push a 'job assigned' notification to all of a tech's devices."""
        tokens = await self._repo.list_tokens(tech_id)
        if not tokens:
            return
        messages = [
            {
                "to": token,
                "title": "New job assigned",
                "body": f"Job #{job_token} was assigned to you.",
                "data": {"job_token": job_token},
            }
            for token in tokens
            if token.startswith("ExponentPushToken")
        ]
        if not messages:
            return
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(
                    EXPO_PUSH_URL,
                    json=messages,
                    headers={"Content-Type": "application/json"},
                )
        except Exception:  # noqa: BLE001 — push is best-effort; never break the caller
            logger.warning("expo push send failed for tech %s", tech_id, exc_info=True)
