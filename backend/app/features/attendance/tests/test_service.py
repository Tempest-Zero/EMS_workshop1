"""Unit tests for `AttendanceService`. Repository + storage are mocked, so these
run without a database or R2 (mirrors the media slice)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.core.storage import SignedUpload
from app.features.attendance.models import AttendanceEvent
from app.features.attendance.schemas import AdjustmentRequest, PunchRequest
from app.features.attendance.service import (
    AttendanceNotFoundError,
    AttendanceService,
    SelfieTooLargeError,
)

# 2026-06-03 is a Wednesday. 04:00 UTC == 09:00 in Asia/Karachi (UTC+5).
NINE_AM_PKT = datetime(2026, 6, 3, 4, 0, tzinfo=UTC)
SIX_PM_PKT = datetime(2026, 6, 3, 13, 0, tzinfo=UTC)


def _event(**overrides: object) -> AttendanceEvent:
    """Build an in-memory event without going through SQLAlchemy defaults."""
    event = AttendanceEvent(
        id=uuid4(),
        client_id=uuid4(),
        shop_id="default",
        tech_id="t1",
        kind="clock_in",
        source="mobile",
        server_time=NINE_AM_PKT,
        device_time=None,
        drift_seconds=None,
        lat=None,
        lng=None,
        accuracy_m=None,
        inside_geofence=None,
        distance_m=None,
        is_mock_location=False,
        selfie_path=None,
        selfie_status="pending",
        selfie_size_bytes=None,
        created_by="t1",
        created_at=NINE_AM_PKT,
    )
    for key, value in overrides.items():
        setattr(event, key, value)
    return event


@pytest.fixture
def svc() -> Iterator[tuple[AttendanceService, MagicMock, MagicMock]]:
    repo = MagicMock()
    repo.get_event_by_client_id = AsyncMock(return_value=None)
    repo.get_event = AsyncMock()
    repo.create_event = AsyncMock(side_effect=lambda **kw: _event(**kw))
    repo.finalize_selfie = AsyncMock()
    repo.reject_selfie = AsyncMock()
    repo.get_active_geofence = AsyncMock(return_value=None)
    repo.list_events = AsyncMock(return_value=[])
    repo.list_shifts = AsyncMock(return_value=[])
    repo.create_adjustment = AsyncMock(return_value=MagicMock(id=uuid4()))

    storage = MagicMock()
    storage.mint_upload_url = MagicMock(
        return_value=SignedUpload(signed_url="https://s/up", token="", expires_in=600)
    )
    storage.mint_playback_url = MagicMock(return_value="https://s/play")
    storage.delete = MagicMock()

    yield AttendanceService(repo, storage), repo, storage


async def test_record_punch_computes_geofence_and_mints_selfie(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=150
    )

    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            lat=24.8601,
            lng=67.0001,
            is_mock_location=False,
            selfie_filename="selfie.jpg",
        )
    )

    repo.create_event.assert_awaited_once()
    kwargs = repo.create_event.await_args.kwargs
    assert kwargs["inside_geofence"] is True
    assert kwargs["selfie_path"].startswith("attendance/default/t1/")
    assert kwargs["selfie_path"].endswith(".jpg")
    assert resp.inside_geofence is True
    assert resp.deduped is False
    assert resp.selfie is not None and resp.selfie.signed_url == "https://s/up"


async def test_record_punch_flags_mock_and_drift(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, _repo, _storage = svc
    # Device clock stuck in the year 2000 → drift far over the 120s default.
    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            is_mock_location=True,
            device_time=datetime(2000, 1, 1, tzinfo=UTC),
        )
    )
    assert resp.is_mock_location is True
    assert resp.drift_flagged is True
    assert resp.selfie is None  # no selfie_filename → no upload URL


async def test_record_punch_is_idempotent_on_client_id(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    existing = _event(selfie_path="attendance/default/t1/x.jpg", selfie_status="pending")
    repo.get_event_by_client_id.return_value = existing

    resp = await service.record_punch(
        PunchRequest(client_id=existing.client_id, tech_id="t1", kind="clock_in")
    )

    assert resp.deduped is True
    assert resp.event_id == existing.id
    repo.create_event.assert_not_awaited()
    # A still-pending selfie gets a fresh upload URL so the retry can finish it.
    assert resp.selfie is not None


async def test_complete_selfie_finalizes_and_returns_playback(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    event = _event(selfie_path="attendance/default/t1/x.jpg", selfie_status="pending")
    repo.get_event.return_value = event

    async def _finalize(e: AttendanceEvent, *, size_bytes: int | None) -> None:
        e.selfie_status = "uploaded"

    repo.finalize_selfie.side_effect = _finalize

    item = await service.complete_selfie(tech_id="t1", event_id=event.id, size_bytes=1000)

    repo.finalize_selfie.assert_awaited_once()
    assert item.selfie_status == "uploaded"
    assert item.selfie_url == "https://s/play"


async def test_complete_selfie_wrong_tech_raises_not_found(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_event.return_value = _event(tech_id="other", selfie_path="p.jpg")
    with pytest.raises(AttendanceNotFoundError):
        await service.complete_selfie(tech_id="t1", event_id=uuid4(), size_bytes=1)


async def test_complete_selfie_without_pending_selfie_raises_not_found(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_event.return_value = _event(selfie_path=None)
    with pytest.raises(AttendanceNotFoundError):
        await service.complete_selfie(tech_id="t1", event_id=uuid4(), size_bytes=1)


async def test_complete_selfie_rejects_oversized_but_keeps_punch(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    event = _event(selfie_path="attendance/default/t1/big.jpg", selfie_status="pending")
    repo.get_event.return_value = event

    with pytest.raises(SelfieTooLargeError):
        await service.complete_selfie(tech_id="t1", event_id=event.id, size_bytes=99 * 1024 * 1024)

    storage.delete.assert_called_once_with("attendance/default/t1/big.jpg")
    repo.reject_selfie.assert_awaited_once_with(event)
    repo.finalize_selfie.assert_not_awaited()


async def test_create_adjustment_appends_manual_event_and_audit(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    resp = await service.create_adjustment(
        AdjustmentRequest(
            tech_id="t1",
            kind="clock_out",
            server_time=SIX_PM_PKT,
            reason="forgot to clock out",
            manager_id="m1",
        )
    )
    repo.create_event.assert_awaited_once()
    assert repo.create_event.await_args.kwargs["source"] == "manual"
    repo.create_adjustment.assert_awaited_once()
    assert resp.new_event_id is not None


async def test_board_classifies_present_day(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT),
        _event(kind="clock_out", server_time=SIX_PM_PKT),
    ]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    assert len(board.rows) == 1
    row = board.rows[0]
    assert row.tech_id == "t1"
    assert row.status == "present"
    assert row.late is False


async def test_record_punch_matches_workshop_wifi(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        wifi_bssids="AA:BB:CC:DD:EE:FF, 11:22:33:44:55:66"
    )

    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            wifi_bssid="aa:bb:cc:dd:ee:ff",  # case-insensitive match
        )
    )

    assert resp.wifi_match is True
    assert repo.create_event.await_args.kwargs["wifi_match"] is True


async def test_record_punch_wifi_miss_when_bssid_not_configured(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(wifi_bssids="AA:BB:CC:DD:EE:FF")

    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(), tech_id="t1", kind="clock_in", wifi_bssid="00:00:00:00:00:00"
        )
    )

    assert resp.wifi_match is False


async def test_board_surfaces_wifi_match(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT, wifi_match=True),
    ]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    assert board.rows[0].wifi_match is True
