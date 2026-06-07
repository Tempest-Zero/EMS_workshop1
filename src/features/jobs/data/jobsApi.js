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

/** Append a note to a job. Returns the full job detail (with the fresh timeline). */
export function addJobNote(id, text) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/notes`, "POST", { text });
}

/** Log a follow-up on a job. Returns the full job detail. */
export function addJobFollowup(id, text) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/followups`, "POST", { text });
}

/**
 * Change a job's status / schedule. `body` is
 * `{ action: "ready"|"close"|"abandon"|"reschedule"|"haul", reason?, preferred_date?, time_window? }`.
 * Returns the full job detail.
 */
export function transitionJob(id, body) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/transition`, "POST", body);
}
