"""Unit tests for NotificationService — repo + httpx mocked, no DB / network."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.features.notifications.service import NotificationService


@pytest.fixture
def svc() -> Iterator[tuple[NotificationService, MagicMock]]:
    repo = MagicMock()
    repo.upsert_token = AsyncMock()
    repo.list_tokens = AsyncMock(return_value=[])
    yield NotificationService(repo), repo


async def test_register_delegates_to_repo(svc: tuple[NotificationService, MagicMock]) -> None:
    service, repo = svc
    await service.register(tech_id="t1", token="ExponentPushToken[abc]", platform="android")
    repo.upsert_token.assert_awaited_once_with(
        tech_id="t1", token="ExponentPushToken[abc]", platform="android"
    )


async def test_notify_with_no_tokens_is_a_noop(svc: tuple[NotificationService, MagicMock]) -> None:
    service, repo = svc
    repo.list_tokens.return_value = []
    await service.notify_assignment(tech_id="t1", job_token=1052)  # must not raise
    repo.list_tokens.assert_awaited_once_with("t1")


async def test_notify_posts_only_expo_tokens(svc: tuple[NotificationService, MagicMock]) -> None:
    service, repo = svc
    repo.list_tokens.return_value = ["ExponentPushToken[abc]", "not-an-expo-token"]
    post = AsyncMock()
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
    client.__aexit__ = AsyncMock(return_value=False)
    with patch("app.features.notifications.service.httpx.AsyncClient", return_value=client):
        await service.notify_assignment(tech_id="t1", job_token=1052)
    post.assert_awaited_once()
    assert post.await_args is not None
    sent = post.await_args.kwargs["json"]
    assert len(sent) == 1  # the garbage token is filtered out
    assert sent[0]["to"] == "ExponentPushToken[abc]"
    assert "1052" in sent[0]["body"]


async def test_notify_swallows_transport_errors(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    service, repo = svc
    repo.list_tokens.return_value = ["ExponentPushToken[abc]"]
    with patch(
        "app.features.notifications.service.httpx.AsyncClient",
        side_effect=RuntimeError("network down"),
    ):
        # Best-effort: a transport failure must not propagate.
        await service.notify_assignment(tech_id="t1", job_token=1052)
