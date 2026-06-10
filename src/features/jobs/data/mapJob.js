/**
 * Maps the snake_case API job to the nested camelCase shape the existing job
 * components expect (customer/appliance objects, etc.).
 *
 * The job's append-only `events` timeline (J2) is mapped to the view's
 * `timeline` and the `note`-kind events are surfaced in `notes`.
 *
 * Bill, work-completion, and the cash/revenue ledger are API-backed (P2f):
 * the manager sees exactly what the technician submitted from the phone. Money
 * arrives as integer paisa and is converted to rupees here (the display unit).
 */

import { fmtDateTime } from "@shared/lib/date";
import { paisaToRupees } from "@shared/lib/currency";

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

/** The bill (auto original + on-site negotiated), paisa → rupees. `null` amounts
 * stay null so the helpers can distinguish "no bill yet" from "Rs 0". */
function mapBill(api) {
  return {
    original: paisaToRupees(api.bill_original_paisa),
    negotiated: paisaToRupees(api.bill_negotiated_paisa),
    status: api.bill_status || "none",
  };
}

/** The cash/revenue ledger entries → the view's `revenue` shape. Voided entries
 * are kept (struck-through in the UI) for the append-only audit trail. */
function mapPayments(payments) {
  return (payments || []).map((p) => ({
    id: p.id,
    amount: paisaToRupees(p.amount_paisa),
    method: p.method,
    voided: Boolean(p.voided),
    voidReason: p.void_reason || undefined,
    ts: p.recorded_at,
    label: p.recorded_at ? fmtDateTime(new Date(p.recorded_at)) : "",
  }));
}

/** The derived route (P3e): straight-line distance + fuel estimate (paisa→rupees). */
function mapRoute(route) {
  if (!route) return null;
  return { distanceM: route.distance_m, fuel: paisaToRupees(route.fuel_paisa) };
}

/** The GPS punches that bound the route, shaped for the view. */
function mapLocations(locations) {
  return (locations || []).map((l) => ({
    id: l.id,
    kind: l.kind,
    lat: l.lat,
    lng: l.lng,
    isMock: Boolean(l.is_mock),
    capturedAt: l.captured_at,
  }));
}

/** The work-completion form → the view's `completion` shape (or `null`). */
function mapCompletion(c) {
  if (!c) return null;
  return {
    materials: (c.materials || []).map((m) => ({
      name: m.name,
      qty: m.qty,
      unitPrice: paisaToRupees(m.unit_paisa),
    })),
    timeSpentMins: c.time_spent_mins ?? 0,
    fuelAmount: paisaToRupees(c.fuel_paisa) ?? 0,
    remarksText: c.remarks_text || "",
    // The voice note lives in the media slice (keyed on token); the manager plays
    // it from the gallery. The completion only carries its media id, not a URL.
    submittedAt: c.submitted_at,
  };
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
    // P2f — bill, completion and the cash ledger are now API-backed (paisa→rupees).
    bill: mapBill(api),
    revenue: mapPayments(api.payments),
    completion: mapCompletion(api.completion),
    // P3e — GPS route + fuel estimate and the punch pins (oversight, read-only).
    route: mapRoute(api.route),
    locations: mapLocations(api.locations),
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
