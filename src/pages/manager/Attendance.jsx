import { useMemo } from "react";
import { useApp } from "../../context/AppContext";
import { Card, SectionHeader } from "../../components/primitives";
import Avatar from "../../components/Avatar";
import { PresenceBadge } from "../../components/StatusChip";
import IntegrationBadge from "../../components/IntegrationBadge";
import { ATT_CELL } from "../../components/MonthDots";
import { attendance, monthSummary } from "../../data/attendance";
import { spanBetween, elapsedSince, parseISO } from "../../lib/date";

const ON_DUTY = ["present", "field", "half"];

function hoursFor(rec) {
  if (!rec) return "—";
  if (rec.clockIn && rec.clockOut) return spanBetween(rec.clockIn, rec.clockOut);
  if (rec.clockIn && rec.clockedIn) return `${elapsedSince(rec.clockIn)} ·`;
  return "—";
}

export default function Attendance() {
  const { technicians, attendanceToday } = useApp();

  const presentCount = technicians.filter((t) =>
    ON_DUTY.includes(attendanceToday[t.id]?.status)
  ).length;

  const days = useMemo(() => attendance[technicians[0].id].map((r) => r.date), [technicians]);

  return (
    <div className="space-y-5">
      {/* Today */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Today"
          sub={`${presentCount} of ${technicians.length} on duty`}
          action={<IntegrationBadge>Synced with Attendance Service</IntegrationBadge>}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                <th className="pb-2">Technician</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Clock In</th>
                <th className="pb-2">Clock Out</th>
                <th className="pb-2 text-right">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {technicians.map((t) => {
                const rec = attendanceToday[t.id];
                return (
                  <tr key={t.id}>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={t.name} color={t.avatar} size="sm" />
                        <div>
                          <div className="font-bold text-slate-800">{t.name}</div>
                          <div className="text-xs text-slate-400">{t.specialty}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5"><PresenceBadge status={rec?.status || "absent"} /></td>
                    <td className="py-2.5 font-medium text-slate-600">{rec?.clockIn || "—"}</td>
                    <td className="py-2.5 font-medium text-slate-600">
                      {rec?.clockOut || (rec?.clockedIn ? <span className="text-emerald-600 font-semibold">On duty</span> : "—")}
                    </td>
                    <td className="py-2.5 text-right font-bold text-slate-700">{hoursFor(rec)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Monthly grid */}
      <Card className="p-4 md:p-5">
        <SectionHeader title="May 2026" sub="Monthly attendance grid" />
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[760px]">
            {/* Day header */}
            <div className="flex items-center gap-1.5 pl-40">
              {days.map((d) => (
                <div key={d} className="w-5 text-center text-[9px] font-bold text-slate-300">
                  {parseISO(d).getDate()}
                </div>
              ))}
            </div>
            {/* Rows */}
            <div className="mt-1 space-y-1.5">
              {technicians.map((t) => {
                const sum = monthSummary(t.id);
                return (
                  <div key={t.id} className="flex items-center gap-1.5">
                    <div className="flex w-40 shrink-0 items-center gap-2 pr-2">
                      <Avatar name={t.name} color={t.avatar} size="sm" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-slate-700">{t.name}</div>
                        <div className="text-[10px] text-slate-400">{sum.present}/{sum.working} present</div>
                      </div>
                    </div>
                    {attendance[t.id].map((r) => (
                      <div
                        key={r.date}
                        title={`${r.date} · ${r.status}`}
                        className={`h-5 w-5 shrink-0 rounded ${ATT_CELL[r.status]}`}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
          {[
            ["present", "Present"],
            ["field", "Field"],
            ["half", "Half-day"],
            ["leave", "Leave"],
            ["absent", "Absent"],
            ["holiday", "Holiday"],
          ].map(([key, label]) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <span className={`h-2.5 w-2.5 rounded-sm ${ATT_CELL[key]}`} />
              {label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
