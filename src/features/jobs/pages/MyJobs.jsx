import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Home, ChevronRight, Clock3 } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, EmptyState } from "@shared/ui/primitives";
import StatusChip from "@shared/ui/StatusChip";
import { formatPKR } from "@shared/lib/currency";
import { amountOwed, hasEstimate } from "@shared/lib/job";
import { daysSince } from "@shared/lib/date";
import { ClipboardList } from "lucide-react";

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "ready", label: "Ready" },
  { key: "all", label: "All" },
];

export default function MyJobs() {
  const { currentTechId, jobsForTech } = useApp();
  const [filter, setFilter] = useState("active");

  const jobs = useMemo(() => {
    const all = jobsForTech(currentTechId, true);
    if (filter === "ready") return all.filter((j) => j.status === "ready");
    if (filter === "active") return all.filter((j) => j.status !== "closed");
    return all;
  }, [currentTechId, jobsForTech, filter]);

  return (
    <div className="p-4 pb-8">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">My Jobs</h1>
        <span className="text-sm font-semibold text-slate-400">{jobs.length}</span>
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
              filter === f.key
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-500 ring-1 ring-inset ring-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {jobs.length ? (
        <div className="space-y-3">
          {jobs.map((j) => {
            const isVisit = j.jobType === "home-visit";
            const waitDays = j.waitingSince ? daysSince(j.waitingSince) : 0;
            return (
              <Link key={j.id} to={`/tech/jobs/${j.id}`}>
                <Card className="p-4 active:scale-[0.99] transition">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-extrabold text-slate-900">#{j.token}</span>
                      <StatusChip status={j.status} />
                    </div>
                    {isVisit && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">
                        <Home className="h-3 w-3" /> Visit
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-base font-bold text-slate-800">{j.customer.name}</div>
                  <div className="text-sm font-semibold text-slate-500">
                    {j.appliance.type} · {j.appliance.brand}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">{j.problem}</p>

                  {j.status === "waiting" && j.waitingReason && (
                    <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700">
                      <Clock3 className="h-3.5 w-3.5 shrink-0" />
                      {j.waitingReason} · {waitDays}d
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-sm font-bold text-slate-700">
                      {hasEstimate(j) ? (
                        formatPKR(amountOwed(j))
                      ) : (
                        <span className="text-slate-400">No estimate</span>
                      )}
                    </span>
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-slate-900">
                      Open <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No jobs" sub="You have no jobs in this view." />
      )}
    </div>
  );
}
