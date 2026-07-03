import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownUp, ArrowLeft, Download, MapPinOff } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { fetchVariance } from "@features/attendance/data/attendanceApi";
import { Button, Card, EmptyState, SectionHeader } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";
import { fmtClock, fmtWorked } from "@features/attendance/lib/format";

// A delta beyond this many minutes (either direction) is worth a manager's eye.
const DELTA_AMBER_MIN = 10;

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Signed minute delta: neutral within ±10 min, amber beyond, em-dash when null. */
function Delta({ minutes }) {
  if (minutes == null) return <span className="text-slate-300">—</span>;
  const amber = Math.abs(minutes) > DELTA_AMBER_MIN;
  const sign = minutes > 0 ? "+" : "";
  return (
    <span className={amber ? "font-bold text-amber-600" : "text-slate-500"}>
      {sign}
      {minutes}m
    </span>
  );
}

function RowFlags({ row }) {
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      {row.flagged_arrived_not_clocked_in && (
        <AlertTriangle
          className="h-4 w-4 text-amber-500"
          aria-label="Arrived but never clocked in"
        />
      )}
      {row.flagged_order && (
        <ArrowDownUp
          className="h-4 w-4 text-amber-500"
          aria-label="Clock-out before clock-in — check punches"
        />
      )}
      {row.flagged_away && (
        <MapPinOff
          className="h-4 w-4 text-amber-500"
          aria-label="Away from the workshop over 30 min"
        />
      )}
    </span>
  );
}

/** Ping coverage of the clocked window (share with location data). */
function Coverage({ pct }) {
  if (pct == null) return <span className="text-slate-300">—</span>;
  return <span className="text-slate-500">{Math.round(pct)}%</span>;
}

/** Minutes the phone read outside the fence; amber once the away flag fires. */
function Away({ minutes, flagged }) {
  if (minutes == null) return <span className="text-slate-300">—</span>;
  if (minutes === 0) return <span className="text-slate-400">0m</span>;
  return (
    <span className={flagged ? "font-bold text-amber-600" : "text-slate-500"}>{minutes}m</span>
  );
}

export default function AttendanceVariance() {
  const { technicians } = useApp();
  const techIds = useMemo(() => technicians.map((t) => t.id), [technicians]);
  const techById = useMemo(
    () => Object.fromEntries(technicians.map((t) => [t.id, t])),
    [technicians]
  );

  const [start, setStart] = useState(() => isoDaysAgo(6));
  const [end, setEnd] = useState(() => isoDaysAgo(0));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // setState lives only in the async callbacks (not the synchronous effect
  // body) — the react-hooks/set-state-in-effect pattern the data hook uses.
  useEffect(() => {
    if (techIds.length === 0) return;
    let active = true;
    fetchVariance(techIds, start, end)
      .then((data) => {
        if (!active) return;
        setReport(data);
        setError(null);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [techIds, start, end]);

  const rows = report?.rows ?? [];

  // Client-side CSV, reusing the manager payroll blob pattern.
  const downloadCsv = () => {
    const flag = (v) => (v ? "1" : "0");
    const header = [
      "Technician",
      "Tech ID",
      "Date",
      "Status",
      "Arrived",
      "Clock In",
      "Delta In (min)",
      "Clock Out",
      "Departed",
      "Delta Out (min)",
      "Hours",
      "Coverage %",
      "Inside Min",
      "Outside Min",
      "No Data Min",
      "Arrived Not Clocked In",
      "Clock Order",
      "Away Flag",
    ];
    const body = rows.map((r) => [
      techById[r.tech_id]?.name ?? r.tech_id,
      r.tech_id,
      r.date,
      r.status,
      fmtClock(r.first_arrive),
      fmtClock(r.first_clock_in),
      r.delta_in_minutes ?? "",
      fmtClock(r.last_clock_out),
      fmtClock(r.last_depart),
      r.delta_out_minutes ?? "",
      r.clocked_minutes == null ? "" : (r.clocked_minutes / 60).toFixed(1),
      r.coverage_pct == null ? "" : Math.round(r.coverage_pct),
      r.inside_minutes ?? "",
      r.outside_minutes ?? "",
      r.no_data_minutes ?? "",
      flag(r.flagged_arrived_not_clocked_in),
      flag(r.flagged_order),
      flag(r.flagged_away),
    ]);
    const csv = [header, ...body]
      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `variance-${report?.from_date}_to_${report?.to_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <Link
        to="/attendance"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" /> Attendance
      </Link>

      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Variance"
          sub="System evidence (geofence crossings) vs manual punches"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
              <span className="text-xs text-slate-400">→</span>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={downloadCsv}
                disabled={rows.length === 0}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
            </div>
          }
        />

        {error ? (
          <div className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
            Couldn’t load variance: {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-3">
            <EmptyState title={loading ? "Loading…" : "No attendance in this range"} />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                  <th className="pb-2">Technician</th>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Arrived</th>
                  <th className="pb-2">Clock In</th>
                  <th className="pb-2 text-right">Δ In</th>
                  <th className="pb-2">Clock Out</th>
                  <th className="pb-2">Departed</th>
                  <th className="pb-2 text-right">Δ Out</th>
                  <th className="pb-2 text-right">Hours</th>
                  <th className="pb-2 text-right">Coverage</th>
                  <th className="pb-2 text-right">Away</th>
                  <th className="pb-2 text-right">Flags</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const t = techById[r.tech_id];
                  return (
                    <tr key={`${r.tech_id}-${r.date}`}>
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={t?.name || r.tech_id} color={t?.avatar} size="sm" />
                          <span className="font-bold text-slate-800">{t?.name || r.tech_id}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-slate-500">{r.date}</td>
                      <td className="py-2.5">
                        <PresenceBadge status={r.status} />
                      </td>
                      <td className="py-2.5 text-slate-600">{fmtClock(r.first_arrive)}</td>
                      <td className="py-2.5 text-slate-600">{fmtClock(r.first_clock_in)}</td>
                      <td className="py-2.5 text-right">
                        <Delta minutes={r.delta_in_minutes} />
                      </td>
                      <td className="py-2.5 text-slate-600">{fmtClock(r.last_clock_out)}</td>
                      <td className="py-2.5 text-slate-600">{fmtClock(r.last_depart)}</td>
                      <td className="py-2.5 text-right">
                        <Delta minutes={r.delta_out_minutes} />
                      </td>
                      <td className="py-2.5 text-right font-bold text-slate-700">
                        {fmtWorked(r.clocked_minutes)}
                      </td>
                      <td className="py-2.5 text-right">
                        <Coverage pct={r.coverage_pct} />
                      </td>
                      <td className="py-2.5 text-right">
                        <Away minutes={r.outside_minutes} flagged={r.flagged_away} />
                      </td>
                      <td className="py-2.5 text-right">
                        <RowFlags row={r} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
