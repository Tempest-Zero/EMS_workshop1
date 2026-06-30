"""Ops slice business logic — assembles the read-only observability surfaces.

Health and metrics are computed from local machinery (DB session, R2 storage,
the in-process metrics registry, the APScheduler handle). The Railway and Sentry
surfaces are added by the proxy modules and delegated to here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.metrics import MetricsRegistry
from app.core.storage import StorageClient
from app.features.ops import health
from app.features.ops.schemas import HealthReport, MetricsResponse


class OpsService:
    def __init__(
        self,
        session: AsyncSession,
        storage: StorageClient,
        registry: MetricsRegistry,
    ) -> None:
        self._session = session
        self._storage = storage
        self._registry = registry

    async def health_report(self, *, scheduler: Any) -> HealthReport:
        """Probe every dependency and roll the verdicts into one report."""
        components = [
            await health.check_database(self._session),
            await health.check_migrations(self._session),
            await health.check_r2(self._storage),
            health.summarize_scheduler(scheduler, enabled=settings.enable_scheduler),
            health.config_presence(),
        ]
        return HealthReport(
            status=health.rollup(components),
            generated_at=datetime.now(UTC),
            components=components,
        )

    def metrics_snapshot(self) -> MetricsResponse:
        """Current in-process request metrics (see ``core.metrics`` for limits)."""
        return MetricsResponse.model_validate(self._registry.snapshot())
