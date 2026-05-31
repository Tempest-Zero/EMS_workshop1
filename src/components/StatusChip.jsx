import { statusConfig, presenceConfig } from "../lib/statusConfig";

export default function StatusChip({ status, size = "sm" }) {
  const c = statusConfig[status] || statusConfig.closed;
  const pad = size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${pad} ${c.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}

export function PresenceBadge({ status, size = "sm" }) {
  const c = presenceConfig[status] || presenceConfig.absent;
  const pad = size === "lg" ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold ${pad} ${c.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
