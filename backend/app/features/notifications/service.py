"""Notifications slice — push registry + delivery via **Firebase Cloud Messaging
(HTTP v1)**, straight from the backend (no Expo relay, nothing to upload to EAS).

The FCM service account lives in a Railway secret (base64 JSON). We mint a
short-lived OAuth token from it (signed JWT → Google token endpoint) and POST to
the FCM v1 send endpoint. Public surface for other slices (jobs calls
``notify_assignment`` on manager-assign). Delivery is **best-effort**: failures
are swallowed so they never break the action that triggered them.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any

import httpx
import jwt

from app.core.config import settings
from app.features.notifications.repository import NotificationRepository

logger = logging.getLogger(__name__)

FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
# Cache the OAuth token (valid ~1h) keyed by service-account email.
_token_cache: dict[str, tuple[str, float]] = {}


def _service_account() -> dict[str, Any] | None:
    raw = settings.fcm_service_account_b64
    if not raw:
        return None
    try:
        return json.loads(base64.b64decode(raw))  # type: ignore[no-any-return]
    except Exception:  # noqa: BLE001 — misconfigured secret → treat push as off
        logger.warning("FCM service account is not valid base64 JSON", exc_info=True)
        return None


async def _access_token(sa: dict[str, Any]) -> str:
    now = time.time()
    cached = _token_cache.get(sa["client_email"])
    if cached and cached[1] > now + 60:
        return cached[0]
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": FCM_SCOPE,
            "aud": sa["token_uri"],
            "iat": int(now),
            "exp": int(now) + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            sa["token_uri"],
            data={
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            },
        )
        resp.raise_for_status()
        token: str = resp.json()["access_token"]
    _token_cache[sa["client_email"]] = (token, now + 3500)
    return token


class NotificationService:
    def __init__(self, repo: NotificationRepository) -> None:
        self._repo = repo

    async def register(self, *, tech_id: str, token: str, platform: str) -> None:
        await self._repo.upsert_token(tech_id=tech_id, token=token, platform=platform)

    async def notify_assignment(self, *, tech_id: str, job_token: int) -> None:
        """Push a 'job assigned' notification to all of a tech's devices via FCM.

        Dead tokens are pruned: a 404/410 means UNREGISTERED (the app was
        uninstalled or the token rotated) — that registration is deleted so the
        registry doesn't fan out to ghosts forever. The deletes are flushed
        here; the caller's commit boundary persists them (the jobs router
        commits again after this call).
        """
        tokens = await self._repo.list_tokens(tech_id)
        if not tokens:
            return
        sa = _service_account()
        if sa is None:
            logger.info("FCM not configured; skipping assignment push")
            return
        try:
            access = await _access_token(sa)
            url = f"https://fcm.googleapis.com/v1/projects/{sa['project_id']}/messages:send"
            headers = {"Authorization": f"Bearer {access}"}
            async with httpx.AsyncClient(timeout=10.0) as client:
                for token in tokens:
                    message = {
                        "message": {
                            "token": token,
                            "notification": {
                                "title": "New job assigned",
                                "body": f"Job #{job_token} was assigned to you.",
                            },
                            "data": {"job_token": str(job_token)},
                        }
                    }
                    resp = await client.post(url, json=message, headers=headers)
                    if resp.status_code in (404, 410):  # UNREGISTERED — dead device
                        logger.info("pruning dead FCM token for tech %s", tech_id)
                        await self._repo.delete_token(token)
                    elif resp.status_code >= 400:
                        logger.warning(
                            "FCM send to tech %s failed (%s): %s",
                            tech_id,
                            resp.status_code,
                            resp.text[:200],
                        )
        except Exception:  # noqa: BLE001 — push is best-effort; never break the caller
            logger.warning("FCM push failed for tech %s", tech_id, exc_info=True)
