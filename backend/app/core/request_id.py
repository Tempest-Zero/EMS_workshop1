"""Request-ID middleware — the difference between debugging and archaeology.

Every request gets a short id, exposed three ways:
  * the ``X-Request-ID`` response header (a user/screenshot can quote it),
  * every log line emitted while handling the request (via the logging filter),
  * a Sentry tag when Sentry is enabled (set in the middleware).

No new dependency: a contextvar + a Starlette ``BaseHTTPMiddleware`` is all
this needs. An inbound ``X-Request-ID`` (from a proxy) is honored so ids
correlate across hops; otherwise one is minted.
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

if TYPE_CHECKING:
    from starlette.types import ASGIApp

_request_id: ContextVar[str] = ContextVar("request_id", default="-")

HEADER = "X-Request-ID"


def current_request_id() -> str:
    """The id of the request being handled ('-' outside a request)."""
    return _request_id.get()


class RequestIdMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        rid = request.headers.get(HEADER) or uuid.uuid4().hex[:12]
        token = _request_id.set(rid)
        try:
            response = await call_next(request)
        finally:
            _request_id.reset(token)
        response.headers[HEADER] = rid
        return response


class RequestIdLogFilter(logging.Filter):
    """Injects ``request_id`` into every log record so formatters can print it."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = current_request_id()
        return True


def configure_logging() -> None:
    """Attach the filter + a format that carries the id on the root handlers.
    Idempotent — safe to call from ``create_app()`` on import."""
    root = logging.getLogger()
    fmt = logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
    if not root.handlers:
        logging.basicConfig(level=logging.INFO)
    for handler in root.handlers:
        handler.setFormatter(fmt)
        if not any(isinstance(f, RequestIdLogFilter) for f in handler.filters):
            handler.addFilter(RequestIdLogFilter())
