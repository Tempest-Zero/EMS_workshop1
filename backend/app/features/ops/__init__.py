"""Ops/admin slice — read-only production observability for the ops console.

Surfaces (both gated by ``deps.require_ops_proxy_token`` — a shared secret in the
``X-Ops-Proxy-Token`` header, no DB role or migration):
  * deep health (DB / R2 / scheduler / migration drift / config presence),
  * in-app API metrics (throughput, error rate, latency percentiles).

These are the two surfaces only the backend can produce. Railway logs/deploys/
metrics and the Sentry issues feed are owned by the standalone ops server
(``ops-server.mjs``), which holds those tokens itself. The slice owns no tables —
it reads core machinery + an in-process metrics registry.
"""
