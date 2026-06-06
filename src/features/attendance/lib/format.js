/** Small formatters for attendance values coming off the API. */

import { fmtTime, MONTHS } from "@shared/lib/date";

// "2026-06" → "Jun 2026".
export function fmtMonthLabel(month) {
  if (!month) return "";
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

// The API returns naive shop-local ISO datetimes (e.g. "2026-06-04T09:02:00").
// `new Date(iso)` parses them in the viewer's local zone, which is fine for a
// clock-time label like "9:02 AM".
export function fmtClock(iso) {
  if (!iso) return "—";
  return fmtTime(new Date(iso));
}

export function fmtWorked(minutes) {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// Current month as "YYYY-MM" (real today; the API caps the grid at server today).
export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}
