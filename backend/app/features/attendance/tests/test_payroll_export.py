"""The weekly payroll export: window math, CSV shape, and the idempotent
scheduled run. Repository + storage are mocked (no DB / R2)."""

from __future__ import annotations

from datetime import date, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.attendance.models import PayrollExportRecord
from app.features.attendance.schemas import PayrollDay, PayrollExport
from app.features.attendance.service import (
    AttendanceService,
    payroll_csv,
    payroll_week_window,
)


def test_week_window_on_a_sunday_ends_that_day() -> None:
    # 2026-06-07 is a Sunday — the scheduler fires that evening.
    assert payroll_week_window(date(2026, 6, 7)) == (date(2026, 6, 1), date(2026, 6, 7))


def test_week_window_midweek_ends_the_previous_sunday() -> None:
    # Wednesday → the completed week (Mon 1st – Sun 7th), never a partial one.
    assert payroll_week_window(date(2026, 6, 10)) == (date(2026, 6, 1), date(2026, 6, 7))


def test_payroll_csv_shape() -> None:
    export = PayrollExport(
        shop_id="default",
        from_date=date(2026, 6, 1),
        to_date=date(2026, 6, 7),
        rows=[
            PayrollDay(
                tech_id="t1",
                date=date(2026, 6, 1),
                status="present",
                first_in=datetime(2026, 6, 1, 4, 0),
                last_out=datetime(2026, 6, 1, 13, 0),
                worked_minutes=540,
            ),
            PayrollDay(tech_id="t2", date=date(2026, 6, 1), status="absent"),
        ],
    )
    lines = payroll_csv(export).strip().split("\n")
    assert lines[0] == "tech_id,date,status,first_in,last_out,worked_minutes"
    assert lines[1].startswith("t1,2026-06-01,present,")
    assert lines[1].endswith(",540")
    assert lines[2] == "t2,2026-06-01,absent,,,"


def _record() -> PayrollExportRecord:
    return PayrollExportRecord(
        id=uuid4(),
        shop_id="default",
        from_date=date(2026, 6, 1),
        to_date=date(2026, 6, 7),
        storage_path="payroll/default/2026-06-01_2026-06-07.csv",
        row_count=2,
        created_at=datetime(2026, 6, 7, 13, 0),
    )


@pytest.fixture
def svc() -> tuple[AttendanceService, MagicMock, MagicMock]:
    repo = MagicMock()
    storage = MagicMock()
    repo.get_export_for_window = AsyncMock(return_value=None)
    repo.add_export = AsyncMock(return_value=_record())
    repo.list_exports = AsyncMock(return_value=[_record()])
    # run_weekly_export reaches payroll() → shifts + events; give it an empty week.
    repo.list_shifts = AsyncMock(return_value=[])
    repo.list_events = AsyncMock(return_value=[])
    service = AttendanceService(repo, storage)
    return service, repo, storage


async def test_run_weekly_export_writes_csv_and_records_it(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    record = await service.run_weekly_export(shop_id="default", today=date(2026, 6, 7))
    assert record.row_count == 2

    storage.put_bytes.assert_called_once()
    path, data, content_type = storage.put_bytes.call_args.args
    assert path == "payroll/default/2026-06-01_2026-06-07.csv"
    assert content_type == "text/csv"
    assert data.startswith(b"tech_id,date,status")

    kwargs = repo.add_export.call_args.kwargs
    assert kwargs["from_date"] == date(2026, 6, 1)
    assert kwargs["to_date"] == date(2026, 6, 7)


async def test_run_weekly_export_is_idempotent_per_window(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    existing = _record()
    repo.get_export_for_window = AsyncMock(return_value=existing)

    record = await service.run_weekly_export(shop_id="default", today=date(2026, 6, 7))

    assert record is existing
    storage.put_bytes.assert_not_called()
    repo.add_export.assert_not_called()


async def test_list_payroll_exports_carries_signed_urls(
    svc: tuple[AttendanceService, MagicMock, MagicMock],
) -> None:
    service, repo, storage = svc
    storage.mint_playback_url = MagicMock(return_value="https://signed/payroll.csv")

    files = await service.list_payroll_exports(shop_id="default")

    assert len(files) == 1
    assert files[0].download_url == "https://signed/payroll.csv"
    assert files[0].row_count == 2
