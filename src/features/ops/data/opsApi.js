/**
 * Typed calls to the backend ops API (`/api/ops/*`), built on the shared client
 * so the ops_viewer JWT is attached automatically. Every Railway/Sentry response
 * is a `{ configured, available, detail, ...data }` envelope (see ProxyGate).
 */

import { apiGet } from "@shared/lib/api";

export function getHealth() {
  return apiGet("/api/ops/health");
}

export function getMetrics() {
  return apiGet("/api/ops/metrics");
}

export function getRailwayServices() {
  return apiGet("/api/ops/railway/services");
}

export function getRailwayDeployments(name) {
  return apiGet(`/api/ops/railway/deployments?name=${encodeURIComponent(name)}`);
}

export function getRailwayLogs(name, { limit = 200, filter = "" } = {}) {
  const params = new URLSearchParams({ name, limit: String(limit) });
  if (filter) params.set("filter", filter);
  return apiGet(`/api/ops/railway/logs?${params.toString()}`);
}

export function getRailwayMetrics(name, hours = 6) {
  return apiGet(`/api/ops/railway/metrics?name=${encodeURIComponent(name)}&hours=${hours}`);
}

export function getSentryIssues(project) {
  return apiGet(
    project
      ? `/api/ops/sentry/issues?project=${encodeURIComponent(project)}`
      : "/api/ops/sentry/issues"
  );
}
