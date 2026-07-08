"""Integration: the job_event outbox + dispatch cursor (W7).

Real Postgres. Every job create emits a ``create`` event whose ``seq`` is
assigned from ``job_event_seq`` (the ORM client-side default), so these tests
exercise the real ordering key and the ``run_dispatch_once`` drain contract.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.jobs.models import DispatchCursor, JobEvent
from app.features.jobs.service import run_dispatch_once

pytestmark = pytest.mark.integration

Headers = dict[str, str]

_INTAKE = {"customer_name": "X", "appliance_type": "Split AC", "problem": "p"}


async def _make_events(client: AsyncClient, headers: Headers, n: int) -> None:
    for _ in range(n):
        resp = await client.post("/api/jobs", json=_INTAKE, headers=headers)
        assert resp.status_code == 201, resp.text


async def test_seq_is_monotonic_and_unique(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    await _make_events(app_client, auth_headers, 3)
    seqs = list((await session.execute(select(JobEvent.seq).order_by(JobEvent.seq))).scalars())
    assert len(seqs) >= 3
    assert seqs == sorted(seqs)  # monotonic in creation order
    assert len(set(seqs)) == len(seqs)  # unique


async def test_dispatch_advances_cursor_on_success(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    await _make_events(app_client, auth_headers, 3)
    seen: list[int] = []

    async def handler(event: JobEvent) -> None:
        seen.append(event.seq)

    delivered = await run_dispatch_once(session, "whatsapp", handler)
    assert delivered >= 3
    cursor = await session.get(DispatchCursor, "whatsapp")
    assert cursor is not None
    assert cursor.last_seq == max(seen)

    # A second run with no new events delivers nothing and holds the cursor.
    again = await run_dispatch_once(session, "whatsapp", handler)
    assert again == 0
    cursor2 = await session.get(DispatchCursor, "whatsapp")
    assert cursor2 is not None
    assert cursor2.last_seq == max(seen)


async def test_handler_failure_leaves_cursor_unmoved(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    await _make_events(app_client, auth_headers, 2)

    async def failing(event: JobEvent) -> None:
        raise RuntimeError("delivery boom")

    delivered = await run_dispatch_once(session, "erp", failing)
    assert delivered == 0
    cursor = await session.get(DispatchCursor, "erp")
    assert cursor is not None
    assert cursor.last_seq == 0  # the failed event retries next tick, not skipped


async def test_dead_letter_advances_past_a_poisoned_event(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    """W11: with a dead_letter handler, a permanently-failing event is advanced
    past (and alarmed) instead of wedging the consumer forever."""
    await _make_events(app_client, auth_headers, 2)
    dead_lettered: list[int] = []

    async def failing(event: JobEvent) -> None:
        raise RuntimeError("poison")

    async def dead_letter(event: JobEvent, _exc: Exception) -> None:
        dead_lettered.append(event.seq)

    processed = await run_dispatch_once(session, "erp2", failing, dead_letter=dead_letter)
    assert processed == 2  # both advanced past despite failing
    assert len(dead_lettered) == 2
    cursor = await session.get(DispatchCursor, "erp2")
    assert cursor is not None
    assert cursor.last_seq == max(dead_lettered)
