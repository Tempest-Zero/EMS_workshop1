"""In-process request metrics — throughput, error rate, latency percentiles.

A deliberately small, dependency-free APM stand-in for the ops console. A
``BaseHTTPMiddleware`` times every request and folds it into a process-wide
``MetricsRegistry``; ``/api/ops/metrics`` reads a snapshot.

HONEST LIMITS (the ops UI states these too, and CLAUDE.md records them):
  * **In-memory, per-process.** Resets on every deploy/restart, and each uvicorn
    worker keeps its own counters. This is fine under the single-replica contract
    the scheduler already assumes (``settings.enable_scheduler``); it is NOT a
    substitute for real APM and must not be trusted across a scale-out.
  * Latency is a bounded reservoir (last ``_RESERVOIR`` samples per route), so
    percentiles describe recent traffic, not all-time history.

No locks: under asyncio a request handler mutates the registry in straight-line
code (no ``await`` between read and write), so concurrent coroutines in one
process can't interleave a single ``record`` call.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

# Per-route latency samples kept for percentile math. 1000 ≈ a few minutes of
# steady traffic; enough to be representative without unbounded growth.
_RESERVOIR = 1000


def _new_reservoir() -> deque[float]:
    return deque(maxlen=_RESERVOIR)


@dataclass(frozen=True)
class RouteMetrics:
    route: str
    count: int
    errors_4xx: int
    errors_5xx: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float


@dataclass(frozen=True)
class MetricsSnapshot:
    uptime_seconds: float
    started_at: float  # epoch seconds, for "since" display
    total_requests: int
    in_flight: int
    error_rate: float  # 5xx fraction of total
    routes: list[RouteMetrics]


@dataclass
class _RouteStat:
    count: int = 0
    errors_4xx: int = 0
    errors_5xx: int = 0
    latencies_ms: deque[float] = field(default_factory=_new_reservoir)


def _percentile(sorted_values: list[float], q: float) -> float:
    """Linear-interpolated percentile of an already-sorted list (q in [0, 1])."""
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    idx = (len(sorted_values) - 1) * q
    lo = int(idx)
    hi = min(lo + 1, len(sorted_values) - 1)
    frac = idx - lo
    return sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac


class MetricsRegistry:
    """Process-wide request counters + latency reservoirs."""

    def __init__(self) -> None:
        self._mono_start = time.monotonic()
        self._started_at = time.time()
        self._routes: dict[str, _RouteStat] = defaultdict(_RouteStat)
        self._total = 0
        self._total_5xx = 0
        self._in_flight = 0

    def inc_in_flight(self) -> None:
        self._in_flight += 1

    def dec_in_flight(self) -> None:
        self._in_flight = max(0, self._in_flight - 1)

    def record(self, *, route: str, status: int, duration_ms: float) -> None:
        stat = self._routes[route]
        stat.count += 1
        self._total += 1
        if 400 <= status < 500:
            stat.errors_4xx += 1
        elif status >= 500:
            stat.errors_5xx += 1
            self._total_5xx += 1
        stat.latencies_ms.append(duration_ms)

    def snapshot(self) -> MetricsSnapshot:
        routes: list[RouteMetrics] = []
        for route, stat in self._routes.items():
            samples = sorted(stat.latencies_ms)
            routes.append(
                RouteMetrics(
                    route=route,
                    count=stat.count,
                    errors_4xx=stat.errors_4xx,
                    errors_5xx=stat.errors_5xx,
                    p50_ms=round(_percentile(samples, 0.50), 2),
                    p95_ms=round(_percentile(samples, 0.95), 2),
                    p99_ms=round(_percentile(samples, 0.99), 2),
                    max_ms=round(samples[-1], 2) if samples else 0.0,
                )
            )
        # Busiest first — the ops table reads top-down.
        routes.sort(key=lambda r: r.count, reverse=True)
        return MetricsSnapshot(
            uptime_seconds=round(time.monotonic() - self._mono_start, 1),
            started_at=self._started_at,
            total_requests=self._total,
            in_flight=self._in_flight,
            error_rate=round(self._total_5xx / self._total, 4) if self._total else 0.0,
            routes=routes,
        )


# Process-wide singleton the middleware writes and the ops service reads.
metrics_registry = MetricsRegistry()


def _route_label(request: Request) -> str:
    """A low-cardinality label like ``GET /api/jobs/{id}``.

    Starlette merges ``endpoint`` + ``path_params`` into the scope after routing
    but not the route template, so we rebuild it: substitute each matched param
    value back to ``{name}``. Unmatched requests (404s, scanners) collapse to one
    bucket so random URLs can't explode the route table.
    """
    method = request.method
    if request.scope.get("endpoint") is None:
        return f"{method} <unmatched>"
    template = request.url.path
    params = request.scope.get("path_params") or {}
    for key, value in params.items():
        if value is not None:
            template = template.replace(str(value), "{" + key + "}", 1)
    return f"{method} {template}"


class MetricsMiddleware(BaseHTTPMiddleware):
    """Times each request and folds it into ``metrics_registry``."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        metrics_registry.inc_in_flight()
        start = time.perf_counter()
        status = 500  # if the handler raises, it surfaces as a 5xx below
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000
            metrics_registry.dec_in_flight()
            metrics_registry.record(
                route=_route_label(request), status=status, duration_ms=duration_ms
            )
