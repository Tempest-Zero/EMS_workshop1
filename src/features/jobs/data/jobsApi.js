/**
 * Jobs endpoints on the shared client. The manager + tech job views read the
 * live FastAPI backend through here (replacing the mock `jobs` data module).
 */

import { apiGet, apiSend } from "@shared/lib/api";

/** List jobs. `params` may include `status`, `tech_id`, `q`, `shop_id`. */
export function fetchJobs(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ""));
  const qs = new URLSearchParams(clean).toString();
  return apiGet(`/api/jobs${qs ? `?${qs}` : ""}`);
}

export function fetchJob(id) {
  return apiGet(`/api/jobs/${encodeURIComponent(id)}`);
}

export function createJob(body) {
  return apiSend("/api/jobs", "POST", body);
}
