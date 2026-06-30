"""Ops/admin slice — read-only production observability for the ops console.

Surfaces (all gated by ``identity.deps.require_ops_access``):
  * deep health (DB / R2 / scheduler / migration drift / config presence),
  * in-app API metrics (throughput, error rate, latency percentiles),
  * Railway proxy (deployments / logs / resource metrics),
  * Sentry issues feed.

The slice owns no tables — it reads core machinery, an in-process metrics
registry, and two outbound HTTP proxies. Secrets stay server-side; the standalone
ops web app only ever receives filtered JSON.
"""
