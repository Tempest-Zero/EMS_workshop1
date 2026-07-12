import { Link } from "react-router-dom";
import { Home, Clock3 } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import StatusChip from "@shared/ui/StatusChip";
import Avatar from "@shared/ui/Avatar";
import { Card } from "@shared/ui/primitives";
import { formatPKR } from "@shared/lib/currency";
import { amountOwed, hasBill } from "@shared/lib/job";
import { daysSince } from "@shared/lib/date";
import { statusConfig } from "@shared/lib/statusConfig";

export default function JobCard({ job }) {
  const { technicians } = useApp();
  const tech = technicians.find((t) => t.id === job.assignedTechId);
  const owed = amountOwed(job);
  const c = statusConfig[job.status];
  // The shop travels for home visits AND pickups; only a carry-in has no leg.
  const isVisit = Boolean(job.jobType) && job.jobType !== "carry-in";
  const typeLabel =
    job.jobType === "pickup-delivery" ? "Pickup" : isVisit ? "Home Visit" : "Carry-in";
  const waitDays = job.waitingSince ? daysSince(job.waitingSince) : 0;
  const readyDays = job.readySince ? daysSince(job.readySince) : 0;

  return (
    <Link to={`/jobs/${job.id}`} className="block">
      <Card className={`overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md`}>
        <div className={`h-1 w-full ${c.bar}`} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold tracking-tight text-slate-900">
                  #{job.token}
                </span>
                <StatusChip status={job.status} />
              </div>
              <div className="mt-1 truncate text-sm font-bold text-slate-800">
                {job.customer.name}
              </div>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              {isVisit ? <Home className="h-3 w-3" /> : null}
              {typeLabel}
            </span>
          </div>

          <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {job.appliance.type} · {job.appliance.brand}
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-slate-600">{job.problem}</p>

          {job.status === "waiting" && job.waitingReason && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
              <Clock3 className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                {job.waitingReason}
                <span className="font-bold"> · {waitDays}d waiting</span>
              </span>
            </div>
          )}

          {job.status === "ready" && readyDays >= 4 && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
              <Clock3 className="h-3.5 w-3.5" />
              Ready {readyDays} days — awaiting pickup
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2">
              <Avatar name={tech?.name || "?"} color={tech?.avatar} size="sm" />
              <span className="text-xs font-semibold text-slate-600">{tech?.name}</span>
            </div>
            <div className="text-right">
              {hasBill(job) ? (
                <span className="text-sm font-extrabold text-slate-900">{formatPKR(owed)}</span>
              ) : (
                <span className="text-xs font-semibold text-slate-400">No bill yet</span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}
