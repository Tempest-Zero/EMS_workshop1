/**
 * Jobs endpoints (mirrors the backend `jobs` slice). The technician app reads
 * its work list and drives the job through its lifecycle here.
 */

import { request } from "./api";

export type JobStatus = "open" | "waiting" | "ready" | "closed";
export type JobType = "carry-in" | "home-visit";

export interface Job {
  id: string;
  token: number;
  shop_id: string;
  status: JobStatus;
  job_type: JobType;
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  appliance_type: string;
  appliance_brand: string | null;
  appliance_model: string | null;
  problem: string;
  assigned_tech_id: string | null;
  preferred_date: string | null;
  time_window: string | null;
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

export interface JobDetail extends Job {
  events: JobEvent[];
}

export type TransitionAction = "ready" | "close" | "abandon" | "reschedule" | "haul";

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
};
