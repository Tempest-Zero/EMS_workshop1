"""Unit tests for the in-process metrics registry + route labelling."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request

from app.core.metrics import MetricsRegistry, _percentile, _route_label


def test_percentile_interpolates() -> None:
    values = [float(n) for n in range(1, 101)]  # 1..100
    assert _percentile(values, 0.50) == 50.5
    assert _percentile(values, 0.95) == 95.05
    assert _percentile([], 0.5) == 0.0
    assert _percentile([7.0], 0.99) == 7.0


def test_registry_counts_and_classifies() -> None:
    reg = MetricsRegistry()
    reg.record(route="GET /a", status=200, duration_ms=10.0)
    reg.record(route="GET /a", status=200, duration_ms=30.0)
    reg.record(route="GET /a", status=503, duration_ms=5.0)
    reg.record(route="POST /b", status=404, duration_ms=2.0)

    snap = reg.snapshot()
    assert snap.total_requests == 4
    assert snap.error_rate == round(1 / 4, 4)  # one 5xx of four
    by_route = {r.route: r for r in snap.routes}
    assert by_route["GET /a"].count == 3
    assert by_route["GET /a"].errors_5xx == 1
    assert by_route["POST /b"].errors_4xx == 1
    # Busiest route sorts first.
    assert snap.routes[0].route == "GET /a"


def test_in_flight_never_negative() -> None:
    reg = MetricsRegistry()
    reg.dec_in_flight()
    assert reg.snapshot().in_flight == 0
    reg.inc_in_flight()
    assert reg.snapshot().in_flight == 1


def _request(
    path: str, *, method: str = "GET", with_endpoint: bool, path_params: dict[str, str] | None
) -> Request:
    scope: dict[str, Any] = {
        "type": "http",
        "method": method,
        "path": path,
        "query_string": b"",
        "headers": [],
    }
    if with_endpoint:
        scope["endpoint"] = object()
    if path_params is not None:
        scope["path_params"] = path_params
    return Request(scope)


def test_route_label_templates_path_params() -> None:
    req = _request("/api/jobs/abc123", with_endpoint=True, path_params={"id": "abc123"})
    assert _route_label(req) == "GET /api/jobs/{id}"


def test_route_label_static_path() -> None:
    req = _request("/api/ops/health", with_endpoint=True, path_params={})
    assert _route_label(req) == "GET /api/ops/health"


def test_route_label_unmatched_collapses() -> None:
    req = _request("/random/scan/path", with_endpoint=False, path_params=None)
    assert _route_label(req) == "GET <unmatched>"
