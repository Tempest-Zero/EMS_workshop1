/**
 * Maps the snake_case API job to the nested camelCase shape the existing job
 * components expect (customer/appliance objects, etc.).
 *
 * The job's append-only `events` timeline (J2) is mapped to the view's
 * `timeline` and the `note`-kind events are surfaced in `notes`. The
 * estimate / payment / photos fields aren't backed by the API yet (J4), so they
 * stay empty — the UI renders, and persisting them is a later slice.
 */

import { fmtDateTime } from "@shared/lib/date";

const DEFAULT_LABOR_RATE = 1200;

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : undefined;
}

/** One API timeline event → the view entry shape `{ ts, label, text, kind, by }`. */
function mapEvent(e) {
  const when = e.created_at ? new Date(e.created_at) : new Date();
  return {
    ts: e.created_at || when.toISOString(),
    label: fmtDateTime(when),
    text: e.text,
    kind: e.kind,
    by: e.actor || undefined,
  };
}

/** Map the API `events` array (present on job-detail responses) to the timeline. */
export function mapEvents(events) {
  return (events || []).map(mapEvent);
}

/** The `note`-kind events, shaped for the Problem & Diagnosis notes list. */
function notesFromTimeline(timeline) {
  return timeline
    .filter((e) => e.kind === "note")
    .map((e) => ({ text: e.text.replace(/^Note:\s*/, ""), by: e.by, label: e.label }));
}

export function mapApiJob(api) {
  const timeline = mapEvents(api.events);
  return {
    id: api.id,
    token: api.token,
    status: api.status,
    jobType: api.job_type,
    customer: {
      name: api.customer_name,
      phone: api.customer_phone || "",
      address: api.customer_address || "",
    },
    appliance: {
      type: api.appliance_type,
      brand: api.appliance_brand || "",
      model: api.appliance_model || "",
    },
    problem: api.problem || "",
    assignedTechId: api.assigned_tech_id,
    createdAt: dateOnly(api.created_at),
    closedAt: dateOnly(api.closed_at),
    readySince: dateOnly(api.ready_since),
    waitingSince: dateOnly(api.waiting_since),
    waitingReason: api.waiting_reason || undefined,
    preferredDate: dateOnly(api.preferred_date),
    timeWindow: api.time_window || undefined,
    abandoned: Boolean(api.abandoned),
    abandonReason: api.abandon_reason || undefined,
    // J2 — the append-only timeline + notes come from the API's `events`.
    notes: notesFromTimeline(timeline),
    timeline,
    // Not yet API-backed (J4) — empty so the existing detail view renders cleanly.
    estimate: { status: "none", laborHours: 0, laborRate: DEFAULT_LABOR_RATE, parts: [] },
    payment: { method: "pending", paid: 0 },
    bill: { original: null, negotiated: null, status: "none" },
    revenue: [],
    completion: null,
    photos: [],
    followUps: [],
  };
}

/** Maps the NewJobForm fields to the API's JobCreate body. */
export function toCreateBody(form) {
  return {
    job_type: form.jobType,
    customer_name: form.customerName,
    customer_phone: form.customerPhone || null,
    customer_address: form.address || null,
    appliance_type: form.applianceType,
    appliance_brand: form.brand || null,
    appliance_model: form.model || null,
    problem: form.problem || "",
    assigned_tech_id: form.assignedTechId || null,
    preferred_date: form.preferredDate || null,
    time_window: form.timeWindow || null,
  };
}
