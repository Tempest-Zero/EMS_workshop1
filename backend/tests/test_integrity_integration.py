"""Integration: W12 integrity — job_media.job_uuid + new phases + the
media-orphan sweep. Real Postgres.

The migration's token→job_uuid resolution is proven by the restored-backup
rehearsal (a data transform on real rows); here we cover the app-visible
surface: the resolved FK column, the widened phase CHECK, and the sweep writer.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.models import Job as JobRow
from app.features.jobs.models import JobCompletion
from app.features.jobs.service import run_media_orphan_sweep
from app.features.media.models import JobMedia

pytestmark = pytest.mark.integration


async def _seed_job(session: AsyncSession, *, token: int) -> JobRow:
    job = JobRow(
        token=token, shop_id="default", status="closed", customer_name="X", appliance_type="AC"
    )
    session.add(job)
    await session.flush()
    return job


async def test_job_media_resolves_to_job_and_accepts_new_phases(
    session: AsyncSession,
) -> None:
    job = await _seed_job(session, token=9200)
    media = JobMedia(
        job_id=str(job.token),  # operational key stays the token
        job_uuid=job.id,  # W12 resolved FK
        phase="condition",  # W12 new phase
        type="photo",
        filename="f.jpg",
        storage_path=f"{job.token}/condition/{uuid4()}.jpg",
    )
    session.add(media)
    await session.commit()

    got = await session.get(JobMedia, media.id)
    assert got is not None
    assert got.job_uuid == job.id
    assert got.phase == "condition"


async def test_media_orphan_sweep_flags_only_aged_unresolved(session: AsyncSession) -> None:
    old = datetime.now(UTC) - timedelta(days=3)
    recent = datetime.now(UTC)

    # (a) aged completion whose audio note never materialised → flagged.
    job_a = await _seed_job(session, token=9300)
    dangling = uuid4()
    session.add(JobCompletion(job_id=job_a.id, remarks_audio_media_id=dangling, submitted_at=old))
    # (b) aged completion whose audio note DOES exist → not flagged.
    job_b = await _seed_job(session, token=9301)
    real_media = JobMedia(
        job_id=str(job_b.token), phase="remark", type="audio", filename="a.m4a", storage_path="p"
    )
    session.add(real_media)
    await session.flush()
    session.add(
        JobCompletion(job_id=job_b.id, remarks_audio_media_id=real_media.id, submitted_at=old)
    )
    # (c) recent dangling completion → within the trust window, not yet flagged.
    job_c = await _seed_job(session, token=9302)
    session.add(JobCompletion(job_id=job_c.id, remarks_audio_media_id=uuid4(), submitted_at=recent))
    await session.commit()

    flagged: list[tuple[object, object]] = []

    async def on_orphan(completion_id: object, media_id: object) -> None:
        flagged.append((completion_id, media_id))

    n = await run_media_orphan_sweep(session, on_orphan=on_orphan)
    assert n == 1
    assert len(flagged) == 1
    assert flagged[0][1] == dangling  # only the aged, unresolved one
