/**
 * Typed FastAPI client for the attendance slice. One file per backend slice we
 * consume (see `lib/api.ts` for media). Hand-typed — clearer than generated
 * types for a small surface. Mirrors the backend Pydantic schemas in
 * `backend/app/features/attendance/schemas.py`.
 */

import { config } from "./config";

export type PunchKind = "clock_in" | "clock_out";
export type SelfieStatus = "pending" | "uploaded";

export interface PunchRequest {
  client_id: string;
  tech_id: string;
  kind: PunchKind;
  shop_id?: string;
  device_time?: string; // ISO 8601 — server records its own authoritative time
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  is_mock_location?: boolean;
  wifi_bssid?: string | null;
  wifi_ssid?: string | null;
  selfie_filename?: string | null;
  selfie_content_type?: string | null;
}

export interface SignedSelfie {
  signed_url: string;
  storage_path: string;
  expires_in: number;
}

export interface PunchResponse {
  event_id: string;
  client_id: string;
  server_time: string;
  inside_geofence: boolean | null;
  distance_m: number | null;
  is_mock_location: boolean;
  drift_seconds: number | null;
  drift_flagged: boolean;
  wifi_match: boolean | null;
  selfie: SignedSelfie | null;
  deduped: boolean;
}

export interface PunchItem {
  id: string;
  client_id: string;
  shop_id: string;
  tech_id: string;
  kind: PunchKind;
  source: string;
  server_time: string;
  device_time: string | null;
  drift_seconds: number | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  inside_geofence: boolean | null;
  distance_m: number | null;
  is_mock_location: boolean;
  wifi_bssid: string | null;
  wifi_ssid: string | null;
  wifi_match: boolean | null;
  selfie_status: SelfieStatus;
  selfie_url: string | null;
  created_by: string | null;
  created_at: string;
}

export interface TodayStatus {
  tech_id: string;
  clocked_in: boolean;
  last_in: string | null;
  last_out: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const method = init?.method ?? "GET";
    throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const q = (v: string) => encodeURIComponent(v);

export const attendanceApi = {
  recordPunch: (body: PunchRequest) =>
    request<PunchResponse>("/api/attendance/punches", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completeSelfie: (eventId: string, techId: string, body: { size_bytes?: number }) =>
    request<PunchItem>(
      `/api/attendance/punches/${q(eventId)}/selfie/complete?tech_id=${q(techId)}`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  today: (techId: string, shopId = "default") =>
    request<TodayStatus>(`/api/attendance/today?tech_id=${q(techId)}&shop_id=${q(shopId)}`),

  listPunches: (techId: string, start: string, end: string, shopId = "default") =>
    request<PunchItem[]>(
      `/api/attendance/punches?tech_id=${q(techId)}&start=${q(start)}&end=${q(end)}&shop_id=${q(shopId)}`,
    ),
};
