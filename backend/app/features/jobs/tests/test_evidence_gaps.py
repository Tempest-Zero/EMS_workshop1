"""Evidence reconciliation: closed jobs whose closing video never uploaded.
Repository + media service mocked — no DB."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.features.jobs.models import Job as JobRow
from app.features.jobs.service import JobService

TODAY = date(2026, 6, 10)


def _closed_job(token: int) -> JobRow:
    job = JobRow(
        token=token,
        shop_id="default",
        status="closed",
        job_type="carry-in",
        customer_name=f"Customer {token}",
        appliance_type="Split AC",
        problem="x",
        closed_at=date(2026, 6, 1),
    )
    job.id = uuid4()
    job.abandoned = False
    return job


@pytest.fixture
def svc() -> tuple[JobService, MagicMock, MagicMock]:
    repo = MagicMock()
    media = MagicMock()
    return JobService(repo), repo, media


async def test_flags_closed_jobs_with_no_uploaded_closing_bytes(
    svc: tuple[JobService, MagicMock, MagicMock],
) -> None:
    service, repo, media = svc
    ghost, honest = _closed_job(1051), _closed_job(1052)
    repo.list_closed_unabandoned = AsyncMock(return_value=[ghost, honest])
    # 1052's clip actually landed; 1051's never did (pending forever / no row).
    media.uploaded_closing_counts = AsyncMock(return_value={"1052": 1})

    gaps = await service.evidence_gaps(shop_id="default", media=media, today=TODAY)

    assert [g.token for g in gaps] == [1051]
    assert gaps[0].closing_uploaded == 0
    # The cutoff honors the grace window (offline techs get time to sync).
    kwargs = repo.list_closed_unabandoned.call_args.kwargs
    assert kwargs["closed_before"] == date(2026, 6, 8)


async def test_no_closed_jobs_short_circuits_without_media_call(
    svc: tuple[JobService, MagicMock, MagicMock],
) -> None:
    service, repo, media = svc
    repo.list_closed_unabandoned = AsyncMock(return_value=[])
    media.uploaded_closing_counts = AsyncMock()

    gaps = await service.evidence_gaps(shop_id="default", media=media, today=TODAY)

    assert gaps == []
    media.uploaded_closing_counts.assert_not_awaited()
