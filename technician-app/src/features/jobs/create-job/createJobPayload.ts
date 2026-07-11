/**
 * Maps the intake wizard's screen state to the backend `JobCreate` body.
 * Pure function — the wizard stays a dumb shell and this stays unit-testable.
 */

import type { JobCreateInput, JobType } from "../../../lib/jobsApi";

export interface CreateJobDraft {
  phone: string;
  name: string;
  appliance: string;
  brand: string;
  problemText: string;
  /** True when a problem voice note was recorded (text may then be empty). */
  hasProblemAudio: boolean;
  /** Customer address free text (raw beside the resolved pin — C7). */
  location: string;
  /** Step-3 chip: 'Home visit' | 'Carry-in' | 'Pickup'. */
  serviceType: string;
  timeWindow: string;
  /** Rupees, free-typed. Estimate is NOT a Job column (storyboard gap G1) —
   * it rides the problem text as a labelled suffix until it gets one. */
  estimate: string;
  /** Step-4 chip: 'Approve now' | 'Customer review' | 'Pending'. */
  approval: string;
  consent: boolean;
  customerLat: number | null;
  customerLng: number | null;
  /** The creating technician self-assigns — they're taking the job. */
  techId: string | null;
}

const SERVICE_TYPE: Record<string, JobType> = {
  "Home visit": "home-visit",
  "Carry-in": "carry-in",
  Pickup: "pickup-delivery",
};

/** Digits-only rupee parse; 0 when absent/garbage. */
export function estimateRupees(text: string): number {
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

export function createJobPayload(draft: CreateJobDraft, clientId: string): JobCreateInput {
  const jobType = SERVICE_TYPE[draft.serviceType] ?? "carry-in";
  const isVisit = jobType !== "carry-in";

  let problem = draft.problemText.trim();
  if (!problem && draft.hasProblemAudio) {
    problem = "(voice note attached)";
  }
  const rupees = estimateRupees(draft.estimate);
  if (rupees > 0) {
    problem = `${problem}\n\n[Estimate Rs ${rupees.toLocaleString()} · ${draft.approval}]`.trim();
  }

  return {
    client_id: clientId,
    job_type: jobType,
    customer_name: draft.name.trim(),
    customer_phone: draft.phone.trim() || null,
    customer_address: isVisit ? draft.location.trim() || null : null,
    customer_lat: isVisit ? draft.customerLat : null,
    customer_lng: isVisit ? draft.customerLng : null,
    appliance_type: draft.appliance,
    appliance_brand: draft.brand || null,
    problem,
    assigned_tech_id: draft.techId,
    time_window: isVisit ? draft.timeWindow || null : null,
    intake_channel: "walk_in",
    whatsapp_consent: draft.consent,
  };
}
