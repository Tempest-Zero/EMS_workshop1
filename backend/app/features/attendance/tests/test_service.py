"""Unit tests for `AttendanceService`. Repository + storage are mocked, so these
run without a database or R2 (mirrors the media slice)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy.exc import IntegrityError

from app.core.storage import SignedUpload
from app.features.attendance.models import AttendanceEvent, AttendancePresenceEvent
from app.features.attendance.schemas import (
    AdjustmentRequest,
    PingBatch,
    PingRequest,
    PresenceRequest,
    PunchRequest,
)
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
    # effective_time (D8) defaults to mirror server_time so the rollup tests read
    # the times they set; a test that cares about the offline case overrides it.
    if "effective_time" not in overrides:
        event.effective_time = event.server_time
    return event


def _presence(**overrides: object) -> AttendancePresenceEvent:
    """Build an in-memory presence crossing without SQLAlchemy defaults."""
    event = AttendancePresenceEvent(
        id=uuid4(),
        client_id=uuid4(),
        shop_id="default",
        tech_id="t1",
        kind="arrive",
        source="geofence",
        server_time=NINE_AM_PKT,
        device_time=None,
        drift_seconds=None,
        lat=None,
        lng=None,
        accuracy_m=None,
        inside_geofence=None,
        distance_m=None,
        is_mock_location=False,
        wifi_bssid=None,
        wifi_ssid=None,
        wifi_match=None,
        confirmed=None,
        created_at=NINE_AM_PKT,
    )
    for key, value in overrides.items():
        setattr(event, key, value)
    if "effective_time" not in overrides:
        event.effective_time = event.server_time
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
    repo.get_presence_by_client_id = AsyncMock(return_value=None)
    repo.create_presence = AsyncMock(side_effect=lambda **kw: _presence(**kw))
    repo.list_presence = AsyncMock(return_value=[])
    repo.create_pings = AsyncMock(return_value=0)
    repo.list_pings = AsyncMock(return_value=[])

    storage = MagicMock()
    storage.mint_upload_url = MagicMock(
        return_value=SignedUpload(signed_url="https://s/up", token="", expires_in=600)
    )
    storage.mint_playback_url = MagicMock(return_value="https://s/play")
    # Default: HEAD can't read a size → service falls back to the client value.
    storage.head_size = MagicMock(return_value=None)
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
            accuracy_m=12.0,  # a usable fix — without one the verdict is "uncertain"
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


async def test_record_punch_accuracy_buffer_keeps_fuzzy_inside_fix(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # ~111 m out on an 80 m fence, but a 50 m confidence circle overlaps it.
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=80
    )
    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            lat=24.8610,
            lng=67.0000,
            accuracy_m=50.0,
        )
    )
    assert resp.inside_geofence is True


async def test_record_punch_coarse_fix_is_uncertain_not_outside(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Accuracy over the ceiling: too coarse to judge — inside_geofence stays
    # None (the no-location flag surfaces it), never a false outside/inside.
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=80
    )
    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            lat=24.8610,
            lng=67.0000,
            accuracy_m=500.0,
        )
    )
    assert resp.inside_geofence is None
    assert resp.distance_m is not None  # distance still recorded for forensics


async def test_record_punch_missing_accuracy_is_uncertain(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=80
    )
    resp = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            lat=24.8601,
            lng=67.0001,
            accuracy_m=None,
        )
    )
    assert resp.inside_geofence is None


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


# ── Presence (passive geofence crossings) ────────────────────────────────────
async def test_record_presence_computes_geofence_inside(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=150, wifi_bssids=None
    )

    resp = await service.record_presence(
        PresenceRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="arrive",
            lat=24.8601,
            lng=67.0001,
            accuracy_m=12.0,
        )
    )

    repo.create_presence.assert_awaited_once()
    assert repo.create_presence.await_args.kwargs["inside_geofence"] is True
    assert resp.kind == "arrive"
    assert resp.inside_geofence is True
    assert resp.deduped is False


async def test_record_presence_is_idempotent_on_client_id(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    existing = _presence(kind="arrive", inside_geofence=True, distance_m=5.0)
    repo.get_presence_by_client_id.return_value = existing

    resp = await service.record_presence(
        PresenceRequest(client_id=existing.client_id, tech_id="t1", kind="arrive")
    )

    assert resp.deduped is True
    assert resp.event_id == existing.id
    repo.create_presence.assert_not_awaited()


async def test_presence_and_punch_agree_on_geofence_verdict(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Same shared `_evaluate_geofence` powers both, so a punch and an `arrive`
    # taken at the same coarse fix reach the same "uncertain" verdict.
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=80, wifi_bssids=None
    )
    # Same coarse fix (accuracy over the ceiling) fed to both paths.
    lat, lng, accuracy_m = 24.8610, 67.0000, 500.0

    punch = await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            lat=lat,
            lng=lng,
            accuracy_m=accuracy_m,
        )
    )
    presence = await service.record_presence(
        PresenceRequest(
            client_id=uuid4(), tech_id="t1", kind="arrive", lat=lat, lng=lng, accuracy_m=accuracy_m
        )
    )

    assert punch.inside_geofence is None
    assert presence.inside_geofence is None
    assert presence.distance_m == punch.distance_m  # both recorded for forensics


async def test_tech_days_flags_arrived_but_not_clocked_in(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # The anti-fraud signal: the phone entered the fence (an `arrive` exists)
    # but no clock_in for the day → manager sees "was here, forgot to punch".
    service, repo, _ = svc
    repo.list_events.return_value = []  # no punches at all
    repo.list_presence.return_value = [_presence(kind="arrive", server_time=NINE_AM_PKT)]

    result = await service.tech_days(
        tech_id="t1", shop_id="default", from_date=date(2026, 6, 3), to_date=date(2026, 6, 3)
    )

    day = result.days[0]
    assert day.arrived_not_clocked_in is True
    assert len(day.presence) == 1 and day.presence[0].kind == "arrive"


async def test_tech_days_not_flagged_when_clocked_in(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.list_events.return_value = [_event(kind="clock_in", server_time=NINE_AM_PKT)]
    repo.list_presence.return_value = [_presence(kind="arrive", server_time=NINE_AM_PKT)]

    result = await service.tech_days(
        tech_id="t1", shop_id="default", from_date=date(2026, 6, 3), to_date=date(2026, 6, 3)
    )

    assert result.days[0].arrived_not_clocked_in is False


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
    # A manual correction's effective_time is the corrected time it asserts.
    assert repo.create_event.await_args.kwargs["effective_time"] == SIX_PM_PKT
    repo.create_adjustment.assert_awaited_once()
    assert resp.new_event_id is not None


# ── D8: effective_time (bounded trust of the device clock) ────────────────────
async def test_offline_punch_uses_device_time_as_effective_time(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Captured offline 3h ago, synced now: effective_time is the capture moment
    # (so it buckets on the day it happened), and the clock gap is still flagged.
    service, repo, _ = svc
    captured = datetime.now(UTC) - timedelta(hours=3)
    resp = await service.record_punch(
        PunchRequest(client_id=uuid4(), tech_id="t1", kind="clock_in", device_time=captured)
    )
    kwargs = repo.create_event.await_args.kwargs
    assert kwargs["effective_time"] == captured
    assert kwargs["effective_time"] != kwargs["server_time"]
    assert resp.drift_flagged is True  # ~3h drift > 120s ceiling


async def test_future_device_time_falls_back_to_server_time(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # A device clock 10 min ahead can't be a real capture time (2 min tolerance)
    # — fall back to the authoritative server_time.
    service, repo, _ = svc
    await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            device_time=datetime.now(UTC) + timedelta(minutes=10),
        )
    )
    kwargs = repo.create_event.await_args.kwargs
    assert kwargs["effective_time"] == kwargs["server_time"]


async def test_stale_backdated_device_time_falls_back_to_server_time(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # 30h in the past exceeds the 24h backdate ceiling → server_time wins.
    service, repo, _ = svc
    await service.record_punch(
        PunchRequest(
            client_id=uuid4(),
            tech_id="t1",
            kind="clock_in",
            device_time=datetime.now(UTC) - timedelta(hours=30),
        )
    )
    kwargs = repo.create_event.await_args.kwargs
    assert kwargs["effective_time"] == kwargs["server_time"]


async def test_missing_device_time_uses_server_time(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    await service.record_punch(PunchRequest(client_id=uuid4(), tech_id="t1", kind="clock_in"))
    kwargs = repo.create_event.await_args.kwargs
    assert kwargs["effective_time"] == kwargs["server_time"]


async def test_presence_confirmed_and_effective_time_round_trip(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # The phone's crossing confirmation is persisted verbatim (evidence, never
    # rejected), and a presence crossing gets an effective_time like a punch.
    service, repo, _ = svc
    await service.record_presence(
        PresenceRequest(client_id=uuid4(), tech_id="t1", kind="arrive", confirmed=False)
    )
    kwargs = repo.create_presence.await_args.kwargs
    assert kwargs["confirmed"] is False
    # No device_time given → effective_time is the receipt moment. (Presence
    # server_time is a DB default, so it isn't in the create kwargs to compare;
    # assert effective_time landed at "now" instead.)
    assert (datetime.now(UTC) - kwargs["effective_time"]).total_seconds() < 5


# ── On-duty pings ─────────────────────────────────────────────────────────────
async def test_record_pings_computes_per_ping_geofence_verdicts(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # The fence is fetched ONCE for the whole batch, then each ping is judged
    # in-process: one inside the circle, one ~1.4 km out.
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=150, wifi_bssids=None
    )
    repo.create_pings.return_value = 2
    now = datetime.now(UTC)
    resp = await service.record_pings(
        PingBatch(
            pings=[
                PingRequest(
                    client_id=uuid4(),
                    tech_id="t1",
                    captured_at=now,
                    lat=24.8601,
                    lng=67.0001,
                    accuracy_m=10.0,
                ),
                PingRequest(
                    client_id=uuid4(),
                    tech_id="t1",
                    captured_at=now,
                    lat=24.8700,
                    lng=67.0100,
                    accuracy_m=10.0,
                ),
            ]
        )
    )
    repo.get_active_geofence.assert_awaited_once()  # one fence read, not per-ping
    rows = repo.create_pings.call_args.args[0]
    assert rows[0]["inside_geofence"] is True
    assert rows[1]["inside_geofence"] is False
    assert resp.accepted == 2 and resp.deduped == 0
    assert resp.ping_interval_minutes == 5


async def test_record_pings_coarse_fix_is_uncertain(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Accuracy over the ceiling → inside stays None (never a false verdict), but
    # the distance is still recorded for forensics.
    service, repo, _ = svc
    repo.get_active_geofence.return_value = MagicMock(
        center_lat=24.8600, center_lng=67.0000, radius_m=80, wifi_bssids=None
    )
    repo.create_pings.return_value = 1
    await service.record_pings(
        PingBatch(
            pings=[
                PingRequest(
                    client_id=uuid4(),
                    tech_id="t1",
                    captured_at=datetime.now(UTC),
                    lat=24.8610,
                    lng=67.0000,
                    accuracy_m=500.0,
                ),
            ]
        )
    )
    row = repo.create_pings.call_args.args[0][0]
    assert row["inside_geofence"] is None
    assert row["distance_m"] is not None


async def test_record_pings_reports_dedup_counts(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # 3 sent, repo reports only 1 newly inserted → the other 2 were already-seen
    # client_ids (safe no-ops).
    service, repo, _ = svc
    repo.get_active_geofence.return_value = None
    repo.create_pings.return_value = 1
    resp = await service.record_pings(
        PingBatch(
            pings=[
                PingRequest(client_id=uuid4(), tech_id="t1", captured_at=datetime.now(UTC))
                for _ in range(3)
            ]
        )
    )
    assert resp.accepted == 1
    assert resp.deduped == 2


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


async def test_board_flags_clock_out_before_clock_in(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Clock-out (09:00) precedes clock-in (18:00) on the same local day — the
    # ordering flag must ride onto the board row for a manager to check.
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_out", server_time=NINE_AM_PKT),
        _event(kind="clock_in", server_time=SIX_PM_PKT),
    ]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    assert board.rows[0].flagged_order is True


async def test_board_flags_missing_location_and_selfie(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # The _event defaults are exactly the evasion case: a mobile punch with no
    # GPS fix and a selfie that never uploaded. Both must flag — silence is
    # what made "deny location permission" a free pass.
    service, repo, _ = svc
    repo.list_events.return_value = [_event(kind="clock_in", server_time=NINE_AM_PKT)]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    row = board.rows[0]
    assert row.flagged_no_location is True
    assert row.flagged_no_selfie is True


async def test_board_does_not_flag_manual_adjustments(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # A manager correction never carries GPS/selfie — it must not trip the
    # evidence flags.
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT, source="manual")
    ]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    row = board.rows[0]
    assert row.flagged_no_location is False
    assert row.flagged_no_selfie is False


async def test_board_clean_punch_has_no_evidence_flags(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(
            kind="clock_in",
            server_time=NINE_AM_PKT,
            lat=24.8601,
            lng=67.0001,
            accuracy_m=12.0,
            inside_geofence=True,
            selfie_status="uploaded",
            selfie_path="attendance/default/t1/x.jpg",
        )
    ]

    board = await service.board(shop_id="default", day=date(2026, 6, 3), tech_ids=["t1"])

    row = board.rows[0]
    assert row.flagged_no_location is False
    assert row.flagged_no_selfie is False
    assert row.flagged_order is False


async def test_grid_and_payroll_carry_evidence_flags(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # The flags must reach the artifacts pay is decided from, not just the
    # today-board.
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT, is_mock_location=True)
    ]
    day = date(2026, 6, 3)

    grid = await service.grid(shop_id="default", month="2026-06", tech_ids=["t1"])
    cell = next(c for c in grid.rows[0].cells if c.day == day)
    assert cell.flagged_mock is True
    assert cell.flagged_no_location is True
    assert cell.flagged_no_selfie is True

    payroll = await service.payroll(shop_id="default", from_date=day, to_date=day, tech_ids=["t1"])
    row = next(r for r in payroll.rows if r.date == day)
    assert row.flagged_mock is True
    assert row.flagged_no_location is True
    assert row.flagged_no_selfie is True


# ── Variance report ───────────────────────────────────────────────────────────
async def test_variance_computes_arrival_and_departure_deltas(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # clock-in 09:00 / clock-out 18:00; geofence arrive 08:50, depart 18:10 →
    # the tech clocked in 10 min after arriving and left 10 min after clocking out.
    service, repo, _ = svc
    day = date(2026, 6, 3)
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT),
        _event(kind="clock_out", server_time=SIX_PM_PKT),
    ]
    repo.list_presence.return_value = [
        _presence(kind="arrive", server_time=datetime(2026, 6, 3, 3, 50, tzinfo=UTC)),
        _presence(kind="depart", server_time=datetime(2026, 6, 3, 13, 10, tzinfo=UTC)),
    ]

    report = await service.variance(shop_id="default", from_date=day, to_date=day, tech_ids=["t1"])

    row = next(r for r in report.rows if r.date == day)
    assert row.delta_in_minutes == 10  # clock-in 09:00 − arrive 08:50
    assert row.delta_out_minutes == 10  # depart 18:10 − clock-out 18:00
    assert row.clocked_minutes == 9 * 60
    assert row.inside_minutes is None  # ping fields stay null until Step 7
    assert row.away_intervals == []


async def test_variance_deltas_null_when_presence_missing(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # No geofence crossings: the manual side stands alone, the deltas are null
    # (not zero — there is nothing to compare against).
    service, repo, _ = svc
    day = date(2026, 6, 3)
    repo.list_events.return_value = [
        _event(kind="clock_in", server_time=NINE_AM_PKT),
        _event(kind="clock_out", server_time=SIX_PM_PKT),
    ]
    repo.list_presence.return_value = []

    report = await service.variance(shop_id="default", from_date=day, to_date=day, tech_ids=["t1"])

    row = report.rows[0]
    assert row.first_clock_in is not None
    assert row.first_arrive is None
    assert row.delta_in_minutes is None
    assert row.delta_out_minutes is None


async def test_variance_flags_order_and_omits_holidays(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Out-before-in on Wed 06-03 → flagged_order rides along. The range runs
    # through Sun 06-07 (a holiday under the default Mon–Sat mask), which must be
    # omitted — a non-working day carries no variance.
    service, repo, _ = svc
    repo.list_events.return_value = [
        _event(kind="clock_out", server_time=NINE_AM_PKT),
        _event(kind="clock_in", server_time=SIX_PM_PKT),
    ]

    report = await service.variance(
        shop_id="default", from_date=date(2026, 6, 3), to_date=date(2026, 6, 7), tech_ids=["t1"]
    )

    wed = next(r for r in report.rows if r.date == date(2026, 6, 3))
    assert wed.flagged_order is True
    assert all(r.date != date(2026, 6, 7) for r in report.rows)  # Sunday omitted


async def test_selfie_gaps_maps_events_and_applies_grace_window(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    promised = _event(selfie_path="attendance/default/t1/x.jpg", selfie_status="pending")
    never_attached = _event(selfie_path=None, selfie_status="pending")
    repo.list_punches_missing_selfie = AsyncMock(return_value=[promised, never_attached])

    gaps = await service.selfie_gaps(shop_id="default")

    assert [g.selfie_attached for g in gaps] == [True, False]
    assert gaps[0].event_id == promised.id
    kwargs = repo.list_punches_missing_selfie.call_args.kwargs
    # The grace window: only punches older than ~24h qualify, looking back 14d.
    age = datetime.now(UTC) - kwargs["before"]
    assert timedelta(hours=23) < age < timedelta(hours=25)
    assert kwargs["since"] < kwargs["before"]


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


async def test_list_adjustments_joins_reason_and_event(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, _ = svc
    adj = MagicMock(
        id=uuid4(),
        original_event_id=None,
        reason="forgot to clock out",
        manager_id="m1",
        created_at=SIX_PM_PKT,
    )
    ev = _event(kind="clock_out", server_time=SIX_PM_PKT, tech_id="t1")
    repo.list_adjustments = AsyncMock(return_value=[(adj, ev)])

    items = await service.list_adjustments(shop_id="default", tech_id="t1")

    assert len(items) == 1
    assert items[0].reason == "forgot to clock out"
    assert items[0].tech_id == "t1"
    assert items[0].kind == "clock_out"
    assert items[0].manager_id == "m1"


async def test_record_punch_dedupes_on_raced_insert(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Two requests with the same client_id race: our dedup SELECT sees nothing,
    # then the INSERT trips UNIQUE(client_id). The service must recover and
    # return a clean deduped response instead of bubbling a 500.
    service, repo, _ = svc
    client_id = uuid4()
    winner = _event(client_id=client_id)
    repo.create_event = AsyncMock(side_effect=IntegrityError("dup", {}, Exception()))
    repo.rollback = AsyncMock()
    # First call (initial dedup check) → None; second (post-rollback) → winner.
    repo.get_event_by_client_id = AsyncMock(side_effect=[None, winner])

    resp = await service.record_punch(
        PunchRequest(client_id=client_id, tech_id="t1", kind="clock_in")
    )

    assert resp.deduped is True
    assert resp.event_id == winner.id
    repo.rollback.assert_awaited_once()


async def test_complete_selfie_enforces_real_size_over_client_report(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # Client claims 100 bytes; R2 says 99 MB. The real size wins → rejected.
    service, repo, storage = svc
    event = _event(selfie_path="attendance/default/t1/liar.jpg", selfie_status="pending")
    repo.get_event.return_value = event
    storage.head_size.return_value = 99 * 1024 * 1024

    with pytest.raises(SelfieTooLargeError):
        await service.complete_selfie(tech_id="t1", event_id=event.id, size_bytes=100)

    storage.delete.assert_called_once_with("attendance/default/t1/liar.jpg")
    repo.reject_selfie.assert_awaited_once_with(event)
    repo.finalize_selfie.assert_not_awaited()


async def test_tech_days_does_not_roll_past_today(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    # A range ending in the future must be capped at today, so future days
    # aren't mislabelled "absent" (classify_day's documented contract).
    service, repo, _ = svc
    today = datetime.now(UTC).astimezone(ZoneInfo("Asia/Karachi")).date()
    start = today - timedelta(days=1)
    future = today + timedelta(days=5)

    out = await service.tech_days(tech_id="t1", shop_id="default", from_date=start, to_date=future)

    assert out.to_date == today
    assert all(day.day <= today for day in out.days)
