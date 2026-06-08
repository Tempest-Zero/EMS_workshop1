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

// ── Work completion + bill + cash ledger (Modules 3/4) ───────────────────────
// Money is integer paisa over the wire. Each returns the full job detail.

/**
 * Submit the work-completion form → (re)generates the original bill. `body` is
 * `{ materials: [{name, qty, unit_paisa}], time_spent_mins, fuel_paisa, remarks_text? }`.
 */
export function submitCompletion(id, body) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/completion`, "POST", body);
}

/** Record the negotiated bill amount (the auto original is kept alongside it). */
export function negotiateBill(id, amountPaisa, note) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/bill/negotiate`, "POST", {
    amount_paisa: amountPaisa,
    note: note || null,
  });
}

/**
 * Log a cash/revenue payment. `clientId` (a UUID) makes it idempotent so a retry
 * never double-charges.
 */
export function logPayment(id, amountPaisa, method, clientId) {
  return apiSend(`/api/jobs/${encodeURIComponent(id)}/payments`, "POST", {
    amount_paisa: amountPaisa,
    method,
    client_id: clientId,
  });
}

/** Void (correct) a payment — append-only, kept struck-through for the audit trail. */
export function voidPayment(id, paymentId, reason) {
  return apiSend(
    `/api/jobs/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/void`,
    "POST",
    { reason }
  );
}
