const TONES = {
  ok: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  degraded: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  down: "bg-red-500/15 text-red-400 ring-red-500/30",
  info: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  neutral: "bg-slate-700/40 text-slate-300 ring-slate-600/40",
};

/** Map a backend/Railway status string to a tone. */
function toneFor(status) {
  const s = String(status || "").toUpperCase();
  if (["OK", "SUCCESS", "HEALTHY", "UP", "DEPLOYED"].includes(s)) return "ok";
  if (["DEGRADED", "BUILDING", "DEPLOYING", "WAITING", "QUEUED", "WARN", "WARNING"].includes(s))
    return "degraded";
  if (["DOWN", "FAILED", "CRASHED", "ERROR", "REMOVED"].includes(s)) return "down";
  return "neutral";
}

export default function StatusPill({ status, tone, children }) {
  const t = TONES[tone || toneFor(status)] ?? TONES.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ring-1 ${t}`}
    >
      {children ?? status}
    </span>
  );
}
