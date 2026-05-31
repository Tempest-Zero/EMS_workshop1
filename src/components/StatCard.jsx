import { Card } from "./primitives";

const tones = {
  default: { ring: "", accent: "text-slate-400", value: "text-slate-900" },
  blue: { ring: "ring-1 ring-blue-100", accent: "text-blue-500", value: "text-slate-900" },
  amber: { ring: "ring-1 ring-amber-200 bg-amber-50", accent: "text-amber-500", value: "text-amber-900" },
  green: { ring: "ring-1 ring-emerald-100", accent: "text-emerald-500", value: "text-slate-900" },
  red: { ring: "ring-1 ring-red-200", accent: "text-red-500", value: "text-slate-900" },
};

export default function StatCard({ label, value, sub, tone = "default", icon: Icon, onClick }) {
  const t = tones[tone] || tones.default;
  const clickable = onClick
    ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md"
    : "";
  return (
    <Card className={`p-4 ${t.ring} ${clickable}`} onClick={onClick}>
      <div className="flex items-start justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        {Icon && <Icon className={`h-5 w-5 ${t.accent}`} />}
      </div>
      <div className={`mt-2 text-3xl font-extrabold tracking-tight ${t.value}`}>{value}</div>
      {sub && <div className="mt-1 text-xs font-medium text-slate-500">{sub}</div>}
    </Card>
  );
}
