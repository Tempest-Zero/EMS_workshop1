/**
 * Attendance endpoints, built on the shared web client. The manager screens read
 * the live FastAPI backend through here (replacing the mock `attendance` data
 * module for the manager views). The technician roster is still mock — we pass
 * the known tech ids as `tech_ids` so absentees show up even before they punch.
 */

import { apiGet } from "@shared/lib/api";

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
