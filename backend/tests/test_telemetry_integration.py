"""Integration: telemetry ingest + the metric rollup (W11).

Real Postgres. The ingest endpoint dedups on client_id and derives actor_kind
from the JWT; the rollup diffs the in-process metrics registry against its
baseline and persists the delta.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import metrics_registry
from app.features.telemetry.models import AppEvent, OpsMetricRollup
from app.features.telemetry.service import MetricRollup

pytestmark = pytest.mark.integration

Headers = dict[str, str]


async def test_ingest_dedups_on_client_id_and_derives_actor(
    app_client: AsyncClient, auth_headers: Headers, session: AsyncSession
) -> None:
    shared = str(uuid4())
    body = {
        "events": [
            {"client_id": shared, "name": "screen_view", "props": {"screen": "jobs"}},
            {"client_id": str(uuid4()), "name": "bill_negotiated", "props": {}},
        ]
    }
    first = await app_client.post("/api/events", json=body, headers=auth_headers)
    assert first.status_code == 200, first.text
    assert first.json() == {"accepted": 2, "duplicate": 0}

    # Replaying the same batch is a safe no-op (outbox dedupe on client_id).
    replay = await app_client.post("/api/events", json=body, headers=auth_headers)
    assert replay.json() == {"accepted": 0, "duplicate": 2}

    events = (await session.execute(select(AppEvent))).scalars().all()
    assert len(events) == 2
    # auth_headers is the seeded manager t1 → actor derived from the JWT, not body.
    assert {e.actor_kind for e in events} == {"manager"}
    assert all(e.actor_id == "t1" for e in events)


async def test_ingest_rejects_oversized_batch(
    app_client: AsyncClient, auth_headers: Headers
) -> None:
    body = {"events": [{"client_id": str(uuid4()), "name": "x"} for _ in range(101)]}
    resp = await app_client.post("/api/events", json=body, headers=auth_headers)
    assert resp.status_code == 422


async def test_ingest_requires_auth(app_client: AsyncClient) -> None:
    body = {"events": [{"client_id": str(uuid4()), "name": "x"}]}
    resp = await app_client.post("/api/events", json=body)
    assert resp.status_code == 401


async def test_metric_rollup_skips_first_tick_then_records_delta(
    session: AsyncSession,
) -> None:
    rollup = MetricRollup()
    # First tick seeds the baseline and writes nothing (no start-to-first-tick
    # garbage window).
    assert await rollup.tick(session) == 0

    route = "GET /telemetry-rollup-probe"
    for _ in range(3):
        metrics_registry.record(route=route, status=200, duration_ms=5.0)

    written = await rollup.tick(session)
    assert written >= 2  # the route row + the _all totals row

    probe = (
        (
            await session.execute(
                select(OpsMetricRollup).where(OpsMetricRollup.route.contains("probe"))
            )
        )
        .scalars()
        .all()
    )
    assert len(probe) == 1
    assert probe[0].count == 3
    assert probe[0].method == "GET"

    all_rows = (
        (await session.execute(select(OpsMetricRollup).where(OpsMetricRollup.route == "_all")))
        .scalars()
        .all()
    )
    assert len(all_rows) == 1
    assert all_rows[0].count == 3  # only the probe route changed between ticks
