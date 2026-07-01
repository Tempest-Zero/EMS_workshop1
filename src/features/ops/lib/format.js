/** Small, dependency-free formatters for the ops UI. */

export function fmtRelative(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return "in the future";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function fmtClock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtUptime(seconds) {
  if (seconds == null) return "—";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtMs(n) {
  if (n == null) return "—";
  if (n < 1) return `${n.toFixed(2)} ms`;
  if (n < 1000) return `${n.toFixed(1)} ms`;
  return `${(n / 1000).toFixed(2)} s`;
}

export function fmtPct(fraction) {
  if (fraction == null) return "—";
  return `${(fraction * 100).toFixed(2)}%`;
}

/** Lucene-ish severity → tone for log lines. */
export function severityTone(severity) {
  const s = String(severity || "").toLowerCase();
  if (s.includes("err") || s.includes("crit") || s.includes("fatal")) return "down";
  if (s.includes("warn")) return "degraded";
  return "neutral";
}
