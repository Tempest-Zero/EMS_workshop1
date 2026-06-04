import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Clock, MapPinOff, ShieldAlert, Wifi } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, EmptyState, SectionHeader } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";
import { parseISO } from "@shared/lib/date";
import { ATT_CELL } from "@features/attendance/lib/cells";
import { useAttendanceData } from "@features/attendance/hooks/useAttendanceData";
import { currentMonth, fmtClock, fmtMonthLabel, fmtWorked } from "@features/attendance/lib/format";

const LEGEND = [
  ["present", "Present"],
  ["field", "Field"],
  ["half", "Half-day"],
  ["leave", "Leave"],
  ["absent", "Absent"],
  ["holiday", "Holiday"],
];

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
    </span>
  );
}

function Flags({ row }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {row.flagged_mock && <ShieldAlert className="h-4 w-4 text-red-500" aria-label="Mock GPS" />}
      {row.flagged_outside && (
        <MapPinOff className="h-4 w-4 text-amber-500" aria-label="Outside geofence" />
      )}
      {row.flagged_drift && <Clock className="h-4 w-4 text-amber-500" aria-label="Clock drift" />}
      {row.wifi_match === true && (
        <Wifi className="h-4 w-4 text-emerald-500" aria-label="On workshop WiFi" />
      )}
    </span>
  );
}

export default function Attendance() {
  const { technicians } = useApp();
  const techIds = useMemo(() => technicians.map((t) => t.id), [technicians]);
  const month = useMemo(() => currentMonth(), []);
  const { board, grid, loading, error } = useAttendanceData(techIds, month);

  const boardByTech = useMemo(
    () => Object.fromEntries((board?.rows || []).map((r) => [r.tech_id, r])),
    [board]
  );
  const techById = useMemo(
    () => Object.fromEntries(technicians.map((t) => [t.id, t])),
    [technicians]
  );

  if (error) {
    return (
      <Card className="p-5">
        <SectionHeader title="Attendance" sub="Live from the Attendance API" />
        <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          Couldn’t reach the Attendance API: {error}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Today */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Today"
          sub={loading && !board ? "Loading…" : `${board?.rows?.length ?? 0} technicians`}
          action={<LiveBadge />}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                <th className="pb-2">Technician</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Clock In</th>
                <th className="pb-2">Clock Out</th>
                <th className="pb-2 text-right">Hours</th>
                <th className="pb-2 text-right">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {technicians.map((t) => {
                const row = boardByTech[t.id];
                const status = row?.status || "absent";
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
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        <PresenceBadge status={status} />
                        {row?.late && (
                          <span className="text-[10px] font-bold text-amber-600">LATE</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 font-medium text-slate-600">{fmtClock(row?.first_in)}</td>
                    <td className="py-2.5 font-medium text-slate-600">{fmtClock(row?.last_out)}</td>
                    <td className="py-2.5 text-right font-bold text-slate-700">
                      {fmtWorked(row?.worked_minutes)}
                    </td>
                    <td className="py-2.5 text-right">{row ? <Flags row={row} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Monthly grid */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title={fmtMonthLabel(grid?.month || month)}
          sub="Monthly grid · tap a technician for detail"
        />
        {grid && grid.rows.length > 0 ? (
          <div className="mt-3 overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="flex items-center gap-1.5 pl-40">
                {grid.rows[0].cells.map((c) => (
                  <div key={c.day} className="w-5 text-center text-[9px] font-bold text-slate-300">
                    {parseISO(c.day).getDate()}
                  </div>
                ))}
              </div>
              <div className="mt-1 space-y-1.5">
                {grid.rows.map((row) => {
                  const t = techById[row.tech_id];
                  return (
                    <Link
                      key={row.tech_id}
                      to={`/attendance/${row.tech_id}`}
                      className="flex items-center gap-1.5 rounded hover:bg-slate-50"
                    >
                      <div className="flex w-40 shrink-0 items-center gap-2 pr-2">
                        <Avatar name={t?.name || row.tech_id} color={t?.avatar} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-bold text-slate-700">
                            {t?.name || row.tech_id}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {row.present}/{row.working} present
                          </div>
                        </div>
                      </div>
                      {row.cells.map((c) => (
                        <div
                          key={c.day}
                          title={`${c.day} · ${c.status}${c.late ? " · late" : ""}`}
                          className={`h-5 w-5 shrink-0 rounded ${ATT_CELL[c.status]}`}
                        />
                      ))}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <EmptyState title={loading ? "Loading…" : "No attendance yet this month"} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1.5">
          {LEGEND.map(([key, label]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500"
            >
              <span className={`h-2.5 w-2.5 rounded-sm ${ATT_CELL[key]}`} />
              {label}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
