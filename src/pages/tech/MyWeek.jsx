import { Link } from "react-router-dom";
import { Home, Wrench, ChevronRight } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Card, EmptyState } from "../../components/primitives";
import StatusChip from "../../components/StatusChip";
import { weekForTech } from "../../data/schedule";
import { TODAY } from "../../data/constants";
import { fmtDate } from "../../lib/date";
import { CalendarDays } from "lucide-react";

export default function MyWeek() {
  const { currentTechId, getJob } = useApp();
  const week = weekForTech(currentTechId);
  const total = week.reduce((n, d) => n + d.items.length, 0);

  return (
    <div className="p-4 pb-8 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-extrabold tracking-tight text-slate-900">My Week</h1>
        <span className="text-sm font-semibold text-slate-400">{total} jobs</span>
      </div>

      {total === 0 && <EmptyState icon={CalendarDays} title="Nothing scheduled" sub="Your week is clear." />}

      {week.map((d) => {
        const isToday = d.date === TODAY;
        if (d.items.length === 0 && !isToday) return null;
        return (
          <div key={d.date}>
            <div className={`mb-1.5 flex items-center gap-2 px-1 ${isToday ? "" : ""}`}>
              <span className={`text-sm font-extrabold ${isToday ? "text-slate-900" : "text-slate-500"}`}>{d.label}</span>
              <span className="text-xs text-slate-400">{fmtDate(d.date)}</span>
              {isToday && <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">Today</span>}
            </div>
            {d.items.length ? (
              <div className="space-y-2">
                {d.items.map((a) => {
                  const job = getJob(a.jobId);
                  if (!job) return null;
                  const visit = a.kind === "visit";
                  return (
                    <Link key={a.jobId} to={`/tech/jobs/${a.jobId}`}>
                      <Card className={`p-3 active:scale-[0.99] transition ${visit ? "ring-1 ring-blue-100" : ""}`}>
                        <div className="flex items-center gap-2">
                          {visit ? <Home className="h-4 w-4 text-blue-500" /> : <Wrench className="h-4 w-4 text-slate-400" />}
                          <span className="text-sm font-extrabold text-slate-900">#{job.token}</span>
                          <StatusChip status={job.status} />
                          <ChevronRight className="ml-auto h-4 w-4 text-slate-300" />
                        </div>
                        <div className="mt-1.5 text-sm font-bold text-slate-800">{job.customer.name}</div>
                        <div className="text-xs text-slate-500">{job.appliance.type} · {job.appliance.brand}</div>
                        {visit && a.window && (
                          <div className="mt-1 inline-block rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600">{a.window}</div>
                        )}
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">No jobs scheduled</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
