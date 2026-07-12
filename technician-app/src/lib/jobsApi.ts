/**
 * Jobs endpoints (mirrors the backend `jobs` slice). The technician app reads
 * its work list and drives the job through its lifecycle here.
 */

import { request } from "./api";

export type JobStatus = "open" | "waiting" | "ready" | "closed";
export type JobType = "carry-in" | "home-visit" | "pickup-delivery";

export interface Job {
  id: string;
  token: number;
  shop_id: string;
  status: JobStatus;
  job_type: JobType;
  /** Echo of the intake idempotency key (0036) — how an offline-queued create
   * finds its server row after sync. NULL on web-created jobs. */
  client_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  /** Home pin from the intake map (0036) — the travel map reads it. */
  customer_lat: number | null;
  customer_lng: number | null;
  /** Appliance category slug (0023, echoed since 0036) — scopes the
   * fault/action/parts pickers. */
  category_id: string | null;
  appliance_type: string;
  appliance_brand: string | null;
  appliance_model: string | null;
  problem: string;
  assigned_tech_id: string | null;
  preferred_date: string | null;
  time_window: string | null;
  // Bill (integer paisa).
  bill_original_paisa: number | null;
  bill_negotiated_paisa: number | null;
  bill_status: string;
  created_at: string;
  updated_at: string;
}

export interface JobEvent {
  id: string;
  kind: string;
  text: string;
  actor: string | null;
  created_at: string;
}

export interface Material {
  name: string;
  qty: number;
  unit_paisa: number;
}

export interface Completion {
  time_spent_mins: number;
  fuel_paisa: number;
  /** How the billed fuel was produced ('manual' | 'estimate' | 'breadcrumbs';
   * null on pre-0035 rows = implicitly manual) + the billed round-trip metres
   * when derived — the bill sheet renders "auto · 12.4 km round trip". */
  fuel_basis: string | null;
  fuel_distance_m: number | null;
  /** Rate snapshot at first submission — labour = mins × rate / 60. */
  labour_rate_paisa: number;
  remarks_text: string | null;
  remarks_audio_media_id: string | null;
  fault_code_id: string | null;
  action_code_id: string | null;
  submitted_at: string;
  materials: Material[];
}

export interface Payment {
  id: string;
  amount_paisa: number;
  method: string;
  voided: boolean;
  void_reason: string | null;
  recorded_at: string;
}

export type LocationKind = "depart_workshop" | "arrive_customer";

export interface JobLocation {
  id: string;
  kind: string;
  lat: number;
  lng: number;
  accuracy_m: number | null;
  is_mock: boolean;
  captured_at: string;
  device_time: string | null;
}

export interface Route {
  /** Billable ONE-WAY distance: breadcrumb path-sum when trusted samples
   * cover the drive, else straight-line × circuity (see `basis`). */
  distance_m: number;
  fuel_paisa: number;
  basis: "estimate" | "breadcrumbs";
  sample_count: number;
  /** What an omitted-fuel completion bills (outbound × 2). */
  round_trip_distance_m: number;
  round_trip_fuel_paisa: number;
}

export interface LocationInput {
  kind: LocationKind;
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  is_mock: boolean;
  device_time?: string | null;
  client_id: string;
}

/** One travel breadcrumb (0035). Idempotent on client_id, batched ≤100. */
export interface TravelSampleInput {
  client_id: string;
  leg: "outbound" | "return" | "delivery";
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  is_mock: boolean;
  captured_at: string;
}

export interface TravelSampleBatchResult {
  accepted: number;
  deduped: number;
  rejected: number;
  /** The refreshed derivation — the phone sees the estimate → breadcrumbs
   * upgrade without a heavy detail refetch. */
  route: Route | null;
}

export interface JobDetail extends Job {
  events: JobEvent[];
  completion: Completion | null;
  payments: Payment[];
  received_paisa: number;
  balance_paisa: number;
  locations: JobLocation[];
  route: Route | null;
}

export type TransitionAction = "ready" | "close" | "abandon" | "reschedule" | "haul";

/** Body for `POST /api/jobs` — mobile intake (0036). `client_id` is the
 * outbox idempotency key: a replayed queued create returns the existing job. */
export interface JobCreateInput {
  client_id: string;
  job_type: JobType;
  customer_name: string;
  customer_phone?: string | null;
  customer_address?: string | null;
  customer_lat?: number | null;
  customer_lng?: number | null;
  appliance_type: string;
  appliance_brand?: string | null;
  /** Resolved catalog category id when the appliance came from a catalog chip;
   * omitted for a hardcoded-fallback pick, where the server text-matches. */
  category_id?: string | null;
  problem?: string;
  assigned_tech_id?: string | null;
  time_window?: string | null;
  intake_channel?: "walk_in" | "whatsapp" | "phone" | "online_form" | "email" | null;
  whatsapp_consent?: boolean;
}

export interface CompletionInput {
  materials: Material[];
  time_spent_mins: number;
  /** OMIT for auto: the server bills the derived round-trip route fuel
   * (0035). An explicit value — including 0 — is the tech's figure and wins. */
  fuel_paisa?: number;
  remarks_text?: string;
  remarks_audio_media_id?: string;
  /** W5 tap-picker slugs — only ever ids that came from the catalog API. */
  fault_code_id?: string;
  action_code_id?: string;
}

function qs(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const clean = Object.entries(params).filter(([, v]) => v != null && v !== "");
  if (clean.length === 0) return "";
  return "?" + clean.map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
}

export const jobsApi = {
  list: (params?: { status?: string; tech_id?: string; q?: string }) =>
    request<Job[]>(`/api/jobs${qs(params)}`),

  get: (id: string) => request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}`),

  // Intake (0036). client_id makes it idempotent — an offline retry returns
  // the already-created job instead of minting a duplicate.
  create: (body: JobCreateInput) =>
    request<Job>(`/api/jobs`, { method: "POST", body: JSON.stringify(body) }),

  claim: (id: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/claim`, { method: "POST" }),

  assign: (id: string, techId: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/assign`, {
      method: "POST",
      body: JSON.stringify({ tech_id: techId }),
    }),

  addNote: (id: string, text: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),

  transition: (id: string, action: TransitionAction, reason?: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/transition`, {
      method: "POST",
      body: JSON.stringify({ action, reason }),
    }),

  // ── Completion + bill + cash (Module 3 post-job / Module 4) ──────────
  submitCompletion: (id: string, body: CompletionInput) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/completion`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  negotiateBill: (id: string, amountPaisa: number, note?: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/bill/negotiate`, {
      method: "POST",
      body: JSON.stringify({ amount_paisa: amountPaisa, note }),
    }),

  // client_id makes the payment idempotent — an offline retry never double-charges.
  logPayment: (id: string, amountPaisa: number, method: string, clientId: string) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount_paisa: amountPaisa, method, client_id: clientId }),
    }),

  voidPayment: (id: string, paymentId: string, reason: string) =>
    request<JobDetail>(
      `/api/jobs/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/void`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),

  // ── GPS route (Phase 3) ──────────────────────────────────────────────
  // Record a punch (depart workshop / arrive customer). client_id makes it
  // idempotent — replaying a queued punch never double-records.
  recordLocation: (id: string, body: LocationInput) =>
    request<JobDetail>(`/api/jobs/${encodeURIComponent(id)}/locations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Breadcrumb batch (0035) — assigned-tech-only server-side; idempotent per
  // sample; a replayed offline batch dedupes.
  recordTravelSamples: (id: string, samples: TravelSampleInput[]) =>
    request<TravelSampleBatchResult>(
      `/api/jobs/${encodeURIComponent(id)}/travel-samples`,
      { method: "POST", body: JSON.stringify({ samples }) },
    ),
};
