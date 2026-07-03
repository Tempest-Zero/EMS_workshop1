/**
 * Typed FastAPI client for the attendance slice. One file per backend slice we
 * consume (see `lib/api.ts` for media). Hand-typed — clearer than generated
 * types for a small surface. Mirrors the backend Pydantic schemas in
 * `backend/app/features/attendance/schemas.py`.
 *
 * Uses the shared auth-aware `request` from `./api`, so every call carries the
 * bearer token (attendance endpoints are auth-guarded since J0.5b) and a 401
 * triggers the same auto sign-out as the media/jobs slices.
 */

import { request } from "./api";

export type PunchKind = "clock_in" | "clock_out";
export type PresenceKind = "arrive" | "depart";
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

export interface Shift {
  shop_id: string;
  tech_id: string;
  start_local: string; // "09:00:00"
  end_local: string;
  working_days: string;
  grace_minutes: number;
  timezone: string;
}

// ── Geofence presence (passive arrive/depart crossings) ──────────────────────
export interface PresenceRequest {
  client_id: string;
  tech_id: string;
  kind: PresenceKind;
  shop_id?: string;
  device_time?: string;
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  is_mock_location?: boolean;
  wifi_bssid?: string | null;
  wifi_ssid?: string | null;
  // Crossing confirmation (D5): true/false/null. Backend persists it verbatim.
  confirmed?: boolean | null;
}

export interface PresenceResponse {
  event_id: string;
  client_id: string;
  server_time: string;
  kind: PresenceKind;
  inside_geofence: boolean | null;
  distance_m: number | null;
  deduped: boolean;
}

/** The minimal circle the phone monitors. `null` = no active fence configured. */
export interface ActiveGeofence {
  name: string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  is_active: boolean;
  // The on-duty ping cadence (minutes) the phone paces its sampling to.
  ping_interval_minutes: number;
}

// ── On-duty pings (interval location samples while clocked in) ────────────────
export interface PingRequest {
  client_id: string;
  tech_id: string;
  shop_id?: string;
  captured_at: string; // ISO — the device clock at the sample (the analytical axis)
  lat?: number | null;
  lng?: number | null;
  accuracy_m?: number | null;
  is_mock_location?: boolean;
  wifi_bssid?: string | null;
  wifi_ssid?: string | null;
}

export interface PingBatchResponse {
  accepted: number;
  deduped: number;
  ping_interval_minutes: number;
}

const q = (v: string) => encodeURIComponent(v);

export const attendanceApi = {
  recordPunch: (body: PunchRequest) =>
    request<PunchResponse>("/api/attendance/punches", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completeSelfie: (eventId: string, techId: string, body: { size_bytes?: number }) =>
    request<PunchItem>(`/api/attendance/punches/${q(eventId)}/selfie/complete?tech_id=${q(techId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  today: (techId: string, shopId = "default") =>
    request<TodayStatus>(`/api/attendance/today?tech_id=${q(techId)}&shop_id=${q(shopId)}`),

  recordPresence: (body: PresenceRequest) =>
    request<PresenceResponse>("/api/attendance/presence", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // A batch of on-duty pings (≤100). The server dedups on client_id, so a
  // re-sent (overlapping) batch is a safe no-op.
  recordPings: (pings: PingRequest[]) =>
    request<PingBatchResponse>("/api/attendance/pings", {
      method: "POST",
      body: JSON.stringify({ pings }),
    }),

  // Readable by any signed-in tech (not manager-gated) so the phone can monitor.
  activeGeofence: (shopId = "default") =>
    request<ActiveGeofence | null>(`/api/attendance/geofence/active?shop_id=${q(shopId)}`),

  listPunches: (techId: string, start: string, end: string, shopId = "default") =>
    request<PunchItem[]>(
      `/api/attendance/punches?tech_id=${q(techId)}&start=${q(start)}&end=${q(end)}&shop_id=${q(shopId)}`,
    ),

  getShift: (techId: string, shopId = "default") =>
    request<Shift>(`/api/attendance/shifts/${q(techId)}?shop_id=${q(shopId)}`),
};
