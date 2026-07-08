"""Telemetry slice — business logic.

Two writers:
  * ``TelemetryService.ingest`` — the request path: a batch of client events,
    deduped on ``client_id`` (the outbox contract).
  * ``MetricRollup`` — the 5-minute scheduler tick: diff the cumulative
    in-process request metrics against the previous baseline and persist the
    delta, so ops history survives the next deploy.

Plus ``record_dead_letter`` — a system event the dispatcher emits when it moves
a poisoned outbox event past the cursor (called from the composition root).
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.metrics import metrics_registry
from app.features.telemetry.models import AppEvent, OpsMetricRollup
from app.features.telemetry.repository import TelemetryRepository
from app.features.telemetry.schemas import EventBatch, EventBatchResult

_ROLLUP_WINDOW_SECONDS = 300


class TelemetryService:
    def __init__(self, repo: TelemetryRepository) -> None:
        self._repo = repo

    async def ingest(
        self, *, batch: EventBatch, shop_id: str, actor_kind: str, actor_id: str | None
    ) -> EventBatchResult:
        """Store a batch of client events. Idempotent per ``client_id`` — a
        replayed batch returns as duplicates, not errors."""
        rows = [
            {
                "client_id": ev.client_id,
                "shop_id": shop_id,
                "actor_kind": actor_kind,
                "actor_id": actor_id,
                "name": ev.name,
                "props": ev.props,
                "device_id": ev.device_id,
                "device_time": ev.device_time,
            }
            for ev in batch.events
        ]
        accepted = await self._repo.insert_events(rows)
        return EventBatchResult(accepted=accepted, duplicate=len(rows) - accepted)


async def record_dead_letter(
    session: AsyncSession, *, shop_id: str, consumer: str, seq: int
) -> None:
    """Emit a system ``outbox_dead_letter`` event (props carry slugs/ints only —
    no PII). Added to the caller's session; the dispatcher commits it alongside
    the cursor advance."""
    session.add(
        AppEvent(
            client_id=uuid4(),
            shop_id=shop_id,
            actor_kind="system",
            actor_id=None,
            name="outbox_dead_letter",
            props={"consumer": consumer, "seq": seq},
            server_time=datetime.now(UTC),
        )
    )


class MetricRollup:
    """Holds the per-route baseline between 5-minute ticks. ``metrics_registry``
    counts are cumulative since boot, so each tick records the DELTA since the
    last one. Single-replica (the scheduler assumption), so a plain in-memory
    baseline is correct.

    The first tick after boot seeds the baseline and writes nothing — otherwise
    the window from process start to the first tick would be a garbage row.
    Percentiles are the live reservoir's, recorded as-is: they describe recent
    traffic, not strictly this window (a documented approximation)."""

    def __init__(self) -> None:
        self._baseline: dict[str, tuple[int, int]] = {}  # route -> (count, errors_5xx)
        self._seeded = False

    async def tick(self, session: AsyncSession) -> int:
        snap = metrics_registry.snapshot()
        current = {r.route: (r.count, r.errors_5xx) for r in snap.routes}
        pct = {r.route: (r.p50_ms, r.p95_ms, r.p99_ms) for r in snap.routes}

        if not self._seeded:
            self._baseline = current
            self._seeded = True
            return 0

        captured = datetime.now(UTC)
        rows: list[OpsMetricRollup] = []
        total_count = total_err = 0
        for route, (count, errs) in current.items():
            base_count, base_err = self._baseline.get(route, (0, 0))
            d_count = count - base_count
            d_err = errs - base_err
            if d_count < 0:  # registry reset mid-window (a deploy) — treat as fresh
                d_count, d_err = count, errs
            if d_count == 0:
                continue
            d_err = max(d_err, 0)
            method, _, path = route.partition(" ")
            p50, p95, p99 = pct[route]
            rows.append(
                OpsMetricRollup(
                    captured_at=captured,
                    window_seconds=_ROLLUP_WINDOW_SECONDS,
                    route=path[:128],
                    method=method[:8],
                    count=d_count,
                    error_count=d_err,
                    p50_ms=int(p50),
                    p95_ms=int(p95),
                    p99_ms=int(p99),
                )
            )
            total_count += d_count
            total_err += d_err

        if total_count:
            rows.append(
                OpsMetricRollup(
                    captured_at=captured,
                    window_seconds=_ROLLUP_WINDOW_SECONDS,
                    route="_all",
                    method="",
                    count=total_count,
                    error_count=total_err,
                )
            )

        if rows:
            session.add_all(rows)
            await session.commit()
        self._baseline = current
        return len(rows)


def actor_kind_for_role(role: str) -> str:
    """Map a JWT role to an ``app_event.actor_kind`` CHECK value. A client can
    only ever be a tech or manager; ``system`` is reserved for server-emitted
    events (e.g. the dead-letter alarm)."""
    return role if role in ("tech", "manager") else "system"
