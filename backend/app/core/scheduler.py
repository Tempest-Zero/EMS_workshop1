"""The time seam: an in-process APScheduler.

core/ provides only the machinery; **main.py registers the actual jobs** (the
composition root may import feature services; core may not). Every job runs in
the app's event loop with its own DB session and must commit/rollback itself.

SINGLE-REPLICA ASSUMPTION (documented on ``settings.enable_scheduler``): each
replica runs its own scheduler, so scaling out duplicates every job. The
payroll job is idempotent on its (shop, week) key, which makes a duplicate run
harmless — keep that property for any job added here, or move to external cron.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from app.core.config import settings

logger = logging.getLogger(__name__)

AsyncJob = Callable[[], Awaitable[None]]


def create_scheduler() -> AsyncIOScheduler:
    return AsyncIOScheduler(timezone=settings.scheduler_timezone)


def _wrap_safe(job: AsyncJob, name: str) -> AsyncJob:
    """One failing run logs + reports to Sentry instead of killing the scheduler."""

    async def _safe_run() -> None:
        try:
            await job()
        except Exception:
            logger.exception("scheduled job %s failed", name)

    return _safe_run


def add_weekly_sunday_job(
    scheduler: AsyncIOScheduler, job: AsyncJob, *, hour: int = 18, name: str = "weekly-job"
) -> None:
    """Every Sunday at ``hour`` local (shop timezone)."""
    scheduler.add_job(
        _wrap_safe(job, name),
        CronTrigger(day_of_week="sun", hour=hour, minute=0),
        id=name,
        replace_existing=True,
        misfire_grace_time=3600,  # a restart within the hour still runs it
    )


def add_daily_job(
    scheduler: AsyncIOScheduler,
    job: AsyncJob,
    *,
    hour: int,
    minute: int = 0,
    name: str = "daily-job",
) -> None:
    """Every day at ``hour:minute`` local (shop timezone)."""
    scheduler.add_job(
        _wrap_safe(job, name),
        CronTrigger(hour=hour, minute=minute),
        id=name,
        replace_existing=True,
        misfire_grace_time=3600,
    )


def add_interval_job(
    scheduler: AsyncIOScheduler,
    job: AsyncJob,
    *,
    seconds: int,
    name: str = "interval-job",
) -> None:
    """Every ``seconds`` (e.g. the outbox dispatcher). ``max_instances=1`` so a
    slow run never overlaps the next tick — the dispatcher must not double-run."""
    scheduler.add_job(
        _wrap_safe(job, name),
        IntervalTrigger(seconds=seconds),
        id=name,
        replace_existing=True,
        max_instances=1,
        coalesce=True,  # a burst of missed ticks collapses to one catch-up run
        misfire_grace_time=seconds,
    )
