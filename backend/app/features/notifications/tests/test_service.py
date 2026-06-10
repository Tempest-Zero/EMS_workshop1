"""Unit tests for NotificationService — repo + token-mint + httpx mocked."""

from __future__ import annotations

from collections.abc import Iterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.features.notifications.service import NotificationService

_SA = {"client_email": "svc@x.iam", "project_id": "fixflow-app-5d0a8", "token_uri": "https://t"}


@pytest.fixture
def svc() -> Iterator[tuple[NotificationService, MagicMock]]:
    repo = MagicMock()
    repo.upsert_token = AsyncMock()
    repo.list_tokens = AsyncMock(return_value=[])
    repo.delete_token = AsyncMock()
    yield NotificationService(repo), repo


def _resp(status: int, text: str = "") -> MagicMock:
    return MagicMock(status_code=status, text=text)


def _client_posting(post: AsyncMock) -> MagicMock:
    """An httpx.AsyncClient async-context mock wired to the given post()."""
    client = MagicMock()
    client.__aenter__ = AsyncMock(return_value=MagicMock(post=post))
    client.__aexit__ = AsyncMock(return_value=False)
    return client


async def test_register_delegates_to_repo(svc: tuple[NotificationService, MagicMock]) -> None:
    service, repo = svc
    await service.register(tech_id="t1", token="fcm-abc", platform="android")
    repo.upsert_token.assert_awaited_once_with(tech_id="t1", token="fcm-abc", platform="android")


async def test_notify_with_no_tokens_is_a_noop(svc: tuple[NotificationService, MagicMock]) -> None:
    service, repo = svc
    repo.list_tokens.return_value = []
    await service.notify_assignment(tech_id="t1", job_token=1052)  # must not raise
    repo.list_tokens.assert_awaited_once_with("t1")


async def test_notify_skips_when_fcm_not_configured(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    service, repo = svc
    repo.list_tokens.return_value = ["fcm-abc"]
    with patch("app.features.notifications.service._service_account", return_value=None):
        with patch("app.features.notifications.service.httpx.AsyncClient") as client:
            await service.notify_assignment(tech_id="t1", job_token=1052)
            client.assert_not_called()


async def test_notify_sends_one_fcm_message_per_token(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    service, repo = svc
    repo.list_tokens.return_value = ["fcm-abc", "fcm-def"]
    post = AsyncMock(return_value=_resp(200))
    client = _client_posting(post)
    with (
        patch("app.features.notifications.service._service_account", return_value=_SA),
        patch(
            "app.features.notifications.service._access_token", new=AsyncMock(return_value="tok")
        ),
        patch("app.features.notifications.service.httpx.AsyncClient", return_value=client),
    ):
        await service.notify_assignment(tech_id="t1", job_token=1052)
    assert post.await_count == 2
    url, kwargs = post.await_args_list[0].args, post.await_args_list[0].kwargs
    assert "fixflow-app-5d0a8/messages:send" in url[0]
    assert kwargs["headers"]["Authorization"] == "Bearer tok"
    assert kwargs["json"]["message"]["data"]["job_token"] == "1052"
    repo.delete_token.assert_not_awaited()  # healthy sends prune nothing


async def test_notify_prunes_unregistered_tokens(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    """FCM 404/410 = UNREGISTERED (app uninstalled / token rotated): that
    registration is deleted so future assignments stop fanning out to ghosts —
    and the other devices still get their send."""
    service, repo = svc
    repo.list_tokens.return_value = ["dead-token", "live-token"]
    post = AsyncMock(side_effect=[_resp(404, "UNREGISTERED"), _resp(200)])
    with (
        patch("app.features.notifications.service._service_account", return_value=_SA),
        patch(
            "app.features.notifications.service._access_token", new=AsyncMock(return_value="tok")
        ),
        patch(
            "app.features.notifications.service.httpx.AsyncClient",
            return_value=_client_posting(post),
        ),
    ):
        await service.notify_assignment(tech_id="t1", job_token=1052)

    assert post.await_count == 2  # the dead token didn't stop the loop
    repo.delete_token.assert_awaited_once_with("dead-token")


async def test_notify_keeps_tokens_on_transient_server_errors(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    # A 500 from FCM is not a dead device — the token must survive.
    service, repo = svc
    repo.list_tokens.return_value = ["fcm-abc"]
    post = AsyncMock(return_value=_resp(500, "backend error"))
    with (
        patch("app.features.notifications.service._service_account", return_value=_SA),
        patch(
            "app.features.notifications.service._access_token", new=AsyncMock(return_value="tok")
        ),
        patch(
            "app.features.notifications.service.httpx.AsyncClient",
            return_value=_client_posting(post),
        ),
    ):
        await service.notify_assignment(tech_id="t1", job_token=1052)
    repo.delete_token.assert_not_awaited()


async def test_notify_swallows_transport_errors(
    svc: tuple[NotificationService, MagicMock],
) -> None:
    service, repo = svc
    repo.list_tokens.return_value = ["fcm-abc"]
    with (
        patch("app.features.notifications.service._service_account", return_value=_SA),
        patch(
            "app.features.notifications.service._access_token",
            new=AsyncMock(side_effect=RuntimeError("token mint failed")),
        ),
    ):
        # Best-effort: a failure mid-send must not propagate.
        await service.notify_assignment(tech_id="t1", job_token=1052)
