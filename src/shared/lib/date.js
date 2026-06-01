import { TODAY } from "@shared/config/constants";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function parseISO(s) {
  if (!s) return new Date(TODAY + "T00:00:00");
  return new Date(s.length <= 10 ? s + "T00:00:00" : s);
}

export function fmtDate(iso, withYear = false) {
  const d = parseISO(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? ", " + d.getFullYear() : ""}`;
}

export function fmtDow(iso) {
  return DOW[parseISO(iso).getDay()];
}

export function fmtTime(date = new Date()) {
  let h = date.getHours();
  const m = date.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}

export function fmtDateTime(date = new Date()) {
  return `${MONTHS[date.getMonth()]} ${date.getDate()}, ${fmtTime(date)}`;
}

// Whole days between an ISO date and a reference (defaults to TODAY).
export function daysSince(iso, ref = TODAY) {
  const a = parseISO(iso);
  const b = parseISO(ref);
  return Math.max(0, Math.round((b - a) / 86400000));
}

// Build a timeline/activity entry stamped at the real current time.
export function nowEntry(text, kind = "log") {
  const now = new Date();
  return { ts: now.toISOString(), label: fmtDateTime(now), text, kind };
}

// Parse a label like "9:02 AM" into a Date on today's calendar day.
export function parseTimeToday(label) {
  if (!label) return null;
  const m = label.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}

// "5h 23m" elapsed since a clock-in label, relative to now.
export function elapsedSince(label, now = new Date()) {
  const t = parseTimeToday(label);
  if (!t) return "—";
  let diff = Math.floor((now - t) / 60000);
  if (diff < 0) diff = 0;
  const h = Math.floor(diff / 60);
  const mm = diff % 60;
  return `${h}h ${String(mm).padStart(2, "0")}m`;
}

// "Xh Ym" span between two time labels on today's calendar day.
export function spanBetween(inLabel, outLabel) {
  const a = parseTimeToday(inLabel);
  const b = parseTimeToday(outLabel);
  if (!a || !b) return "—";
  let diff = Math.floor((b - a) / 60000);
  if (diff < 0) diff = 0;
  return `${Math.floor(diff / 60)}h ${String(diff % 60).padStart(2, "0")}m`;
}

export { MONTHS, DOW };
