/**
 * Attendance endpoints, built on the shared web client. The manager screens read
 * the live FastAPI backend through here (replacing the mock `attendance` data
 * module for the manager views). The technician roster is still mock — we pass
 * the known tech ids as `tech_ids` so absentees show up even before they punch.
 */

import { apiGet, apiSend } from "@shared/lib/api";

export const SHOP_ID = "default";

function techIdsQuery(techIds) {
  return (techIds || []).map((id) => `tech_ids=${encodeURIComponent(id)}`).join("&");
}

export function fetchBoard(techIds, date) {
  const params = new URLSearchParams({ shop_id: SHOP_ID });
  if (date) params.set("date", date);
  const ids = techIdsQuery(techIds);
  return apiGet(`/api/attendance/board?${params.toString()}${ids ? `&${ids}` : ""}`);
}

export function fetchGrid(month, techIds) {
  const params = new URLSearchParams({ shop_id: SHOP_ID, month });
  const ids = techIdsQuery(techIds);
  return apiGet(`/api/attendance/grid?${params.toString()}${ids ? `&${ids}` : ""}`);
}

export function fetchTechDays(techId, start, end) {
  const params = new URLSearchParams({ shop_id: SHOP_ID, start, end });
  return apiGet(`/api/attendance/techs/${encodeURIComponent(techId)}/days?${params.toString()}`);
}

/** The automatically generated weekly CSVs (Sunday scheduler). Each carries a
 * signed `download_url` into R2. Manager-only. */
export function fetchPayrollExports() {
  return apiGet(`/api/attendance/payroll/exports?shop_id=${encodeURIComponent(SHOP_ID)}`);
}

/** Weekly attendance export for payroll/ERP. Omitting dates defaults to the
 * last 7 days on the server. Returns `{ shop_id, from_date, to_date, rows[] }`. */
export function fetchPayroll(techIds, start, end) {
  const params = new URLSearchParams({ shop_id: SHOP_ID });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const ids = techIdsQuery(techIds);
  return apiGet(`/api/attendance/payroll?${params.toString()}${ids ? `&${ids}` : ""}`);
}

/** Punches past the grace window whose selfie never uploaded (manager-only).
 * The flag-side of "selfie is required evidence": capture never blocks, but a
 * gap must surface here instead of passing silently. */
export function fetchSelfieGaps() {
  return apiGet(`/api/attendance/selfie-gaps?shop_id=${encodeURIComponent(SHOP_ID)}`);
}

export function fetchAdjustments(techId) {
  const params = new URLSearchParams({ shop_id: SHOP_ID, tech_id: techId });
  return apiGet(`/api/attendance/adjustments?${params.toString()}`);
}

export function createAdjustment(body) {
  return apiSend("/api/attendance/adjustments", "POST", { shop_id: SHOP_ID, ...body });
}

// ── Manager config: geofence + shifts (the PUT-backed admin surface) ─────────
// Both endpoints require a manager role on the backend; the web is a
// manager-only console, so the logged-in user already qualifies.

/** The shop geofence punches are checked against. Returns `null` if unset. */
export function fetchGeofence() {
  return apiGet(`/api/attendance/geofences?shop_id=${encodeURIComponent(SHOP_ID)}`);
}

/** Create/update the shop geofence. `body` is
 * `{ name, center_lat, center_lng, radius_m, is_active, wifi_bssids? }`. */
export function saveGeofence(body) {
  return apiSend(`/api/attendance/geofences?shop_id=${encodeURIComponent(SHOP_ID)}`, "PUT", body);
}

/** A technician's shift. The backend returns a sensible default when unset, so
 * this always resolves to an editable shift. */
export function fetchShift(techId) {
  return apiGet(
    `/api/attendance/shifts/${encodeURIComponent(techId)}?shop_id=${encodeURIComponent(SHOP_ID)}`
  );
}

/** Create/update a technician's shift. `body` is
 * `{ start_local, end_local, working_days, grace_minutes, timezone }`. */
export function saveShift(techId, body) {
  return apiSend(
    `/api/attendance/shifts/${encodeURIComponent(techId)}?shop_id=${encodeURIComponent(SHOP_ID)}`,
    "PUT",
    body
  );
}
