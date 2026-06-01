import { Link2 } from "lucide-react";

export default function IntegrationBadge({ children, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-2.5 py-1 text-xs font-medium text-slate-500 ${className}`}
    >
      <Link2 className="h-3.5 w-3.5 text-slate-400" />
      {children}
    </span>
  );
}
