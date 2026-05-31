import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Home, Wrench } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Card } from "../../components/primitives";
import Avatar from "../../components/Avatar";
import { weekDays, assignmentsFor } from "../../data/schedule";
import { TODAY } from "../../data/constants";
import { fmtDate } from "../../lib/date";

export default function Schedule() {
  const { technicians, getJob } = useApp();

  return (
    <div className="space-y-4">
      {/* Week nav (decorative) */}
      <div className="flex items-center justify-between">
        <button className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-100" disabled>
          <ChevronLeft className="h-4 w-4" /> Prev
        </button>
        <div className="text-sm font-bold text-slate-700">
          {fmtDate(weekDays[0].date)} – {fmtDate(weekDays[weekDays.length - 1].date, true)}
        </div>
        <button className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-400 hover:bg-slate-100" disabled>
          Next <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <Card className="overflow-x-auto p-0">
        <div className="min-w-[820px]">
          {/* Header row */}
          <div className="grid grid-cols-[140px_repeat(6,1fr)] border-b border-slate-200">
            <div className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">Technician</div>
            {weekDays.map((d) => {
              const isToday = d.date === TODAY;
              return (
                <div
                  key={d.date}
                  className={`px-2 py-2.5 text-center ${isToday ? "bg-slate-900 text-white" : "text-slate-500"}`}
                >
                  <div className="text-xs font-bold uppercase">{d.label}</div>
                  <div className={`text-[11px] ${isToday ? "text-slate-300" : "text-slate-400"}`}>{fmtDate(d.date)}</div>
                </div>
              );
            })}
          </div>

          {/* Tech rows */}
          {technicians.map((t) => (
            <div key={t.id} className="grid grid-cols-[140px_repeat(6,1fr)] border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-2 px-3 py-3">
                <Avatar name={t.name} color={t.avatar} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-slate-700">{t.name}</div>
                  <div className="truncate text-[10px] text-slate-400">{t.specialty}</div>
                </div>
              </div>
              {weekDays.map((d) => {
                const items = assignmentsFor(t.id, d.date);
                const isToday = d.date === TODAY;
                return (
                  <div key={d.date} className={`space-y-1.5 border-l border-slate-100 p-1.5 ${isToday ? "bg-slate-50" : ""}`}>
                    {items.map((a) => {
                      const job = getJob(a.jobId);
                      if (!job) return null;
                      const visit = a.kind === "visit";
                      return (
                        <Link
                          key={a.jobId + d.date}
                          to={`/jobs/${a.jobId}`}
                          title={visit ? `${job.customer.address}${a.window ? " · " + a.window : ""}` : job.customer.name}
                          className={`block rounded-lg border px-2 py-1.5 text-[11px] leading-tight transition hover:shadow-sm ${
                            visit ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center gap-1 font-bold text-slate-800">
                            {visit ? <Home className="h-3 w-3 text-blue-500" /> : <Wrench className="h-3 w-3 text-slate-400" />}
                            #{job.token}
                          </div>
                          <div className="truncate text-slate-500">{job.appliance.type}</div>
                          {visit && a.window && <div className="truncate text-[10px] font-semibold text-blue-600">{a.window}</div>}
                        </Link>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500">
        <span className="inline-flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-slate-400" /> Shop / bench work</span>
        <span className="inline-flex items-center gap-1.5"><Home className="h-3.5 w-3.5 text-blue-500" /> Home visit</span>
      </div>
    </div>
  );
}
