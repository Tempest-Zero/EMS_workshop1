import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownUp,
  CameraOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileSpreadsheet,
  LocateOff,
  MapPinOff,
  ShieldAlert,
  Upload,
  Wifi,
} from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import {
  fetchPayroll,
  fetchPayrollExports,
  fetchSelfieGaps,
} from "@features/attendance/data/attendanceApi";
import { Button, Card, EmptyState, SectionHeader } from "@shared/ui/primitives";
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
      {row.flagged_no_location && (
        <LocateOff className="h-4 w-4 text-red-500" aria-label="No usable location" />
      )}
      {row.flagged_no_selfie && (
        <CameraOff className="h-4 w-4 text-amber-500" aria-label="No selfie" />
      )}
      {row.flagged_order && (
        <ArrowDownUp
          className="h-4 w-4 text-amber-500"
          aria-label="Clock-out before clock-in — check punches"
        />
      )}
      {row.wifi_match === true && (
        <Wifi className="h-4 w-4 text-emerald-500" aria-label="On workshop WiFi" />
      )}
    </span>
  );
}

/** Human labels for a day-cell's evidence flags (tooltip + the red corner dot). */
function cellFlags(c) {
  const out = [];
  if (c.flagged_mock) out.push("mock GPS");
  if (c.flagged_outside) out.push("outside geofence");
  if (c.flagged_drift) out.push("clock drift");
  if (c.flagged_no_location) out.push("no location");
  if (c.flagged_no_selfie) out.push("no selfie");
  if (c.flagged_order) out.push("clock order");
  return out;
}

export default function Attendance() {
  const { technicians } = useApp();
  const techIds = useMemo(() => technicians.map((t) => t.id), [technicians]);
  const [month, setMonth] = useState(() => currentMonth());
  const { board, grid, loading, error } = useAttendanceData(techIds, month);

  const boardByTech = useMemo(
    () => Object.fromEntries((board?.rows || []).map((r) => [r.tech_id, r])),
    [board]
  );
  const techById = useMemo(
    () => Object.fromEntries(technicians.map((t) => [t.id, t])),
    [technicians]
  );

  // The Sunday scheduler's generated CSVs (newest first, signed download URLs).
  const [autoExports, setAutoExports] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchPayrollExports()
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setAutoExports(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Selfie gaps — mobile punches past the 24h grace window whose photo never
  // arrived. Only shown when there are gaps to surface.
  const [selfieGaps, setSelfieGaps] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchSelfieGaps()
      .then((gaps) => {
        if (!cancelled && Array.isArray(gaps)) setSelfieGaps(gaps);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [exporting, setExporting] = useState(false);
  const [csvStart, setCsvStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [csvEnd, setCsvEnd] = useState(() => new Date().toISOString().slice(0, 10));

  // Pull the weekly attendance from the API and download it as a payroll CSV
  // on demand. (The Sunday automation writes the same CSV server-side — see
  // the Weekly exports card below.)
  const downloadPayroll = async () => {
    setExporting(true);
    try {
      const data = await fetchPayroll(techIds, csvStart, csvEnd);
      const t = (iso) =>
        iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const hrs = (m) => (m == null ? "" : (m / 60).toFixed(1));
      const flag = (v) => (v ? "1" : "0");
      const header = [
        "Technician",
        "Tech ID",
        "Date",
        "Status",
        "Clock In",
        "Clock Out",
        "Worked Minutes",
        "Hours",
        "Mock GPS",
        "Outside Geofence",
        "Clock Drift",
        "No Location",
        "No Selfie",
        "Clock Order",
      ];
      const body = (data.rows || []).map((r) => [
        techById[r.tech_id]?.name ?? r.tech_id,
        r.tech_id,
        r.date,
        r.status,
        t(r.first_in),
        t(r.last_out),
        r.worked_minutes ?? "",
        hrs(r.worked_minutes),
        flag(r.flagged_mock),
        flag(r.flagged_outside),
        flag(r.flagged_drift),
        flag(r.flagged_no_location),
        flag(r.flagged_no_selfie),
        flag(r.flagged_order),
      ]);
      const csv = [header, ...body]
        .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
        .join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `payroll-${data.from_date}_to_${data.to_date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

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
          action={
            <div className="flex flex-wrap items-center gap-2">
              <LiveBadge />
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600"
                value={csvStart}
                onChange={(e) => setCsvStart(e.target.value)}
              />
              <span className="text-xs text-slate-400">→</span>
              <input
                type="date"
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-600"
                value={csvEnd}
                onChange={(e) => setCsvEnd(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void downloadPayroll()}
                disabled={exporting}
              >
                <Download className="h-4 w-4" /> {exporting ? "Exporting…" : "Payroll CSV"}
              </Button>
            </div>
          }
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
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5 text-red-500" /> Mock GPS
          </span>
          <span className="flex items-center gap-1">
            <MapPinOff className="h-3.5 w-3.5 text-amber-500" /> Outside geofence
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5 text-amber-500" /> Clock drift
          </span>
          <span className="flex items-center gap-1">
            <LocateOff className="h-3.5 w-3.5 text-red-500" /> No location
          </span>
          <span className="flex items-center gap-1">
            <CameraOff className="h-3.5 w-3.5 text-amber-500" /> No selfie
          </span>
          <span className="flex items-center gap-1">
            <ArrowDownUp className="h-3.5 w-3.5 text-amber-500" /> Clock order
          </span>
          <span className="flex items-center gap-1">
            <Wifi className="h-3.5 w-3.5 text-emerald-500" /> On workshop WiFi
          </span>
        </div>
      </Card>

      {/* Selfie gaps — punches older than 24h whose selfie never arrived */}
      {selfieGaps.length > 0 && (
        <Card className="p-4 md:p-5">
          <SectionHeader
            title="Missing Selfies"
            sub={`${selfieGaps.length} punch${selfieGaps.length === 1 ? "" : "es"} older than 24 h with no photo`}
            action={
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                <CameraOff className="h-3.5 w-3.5" /> {selfieGaps.length}
              </span>
            }
          />
          <div className="mt-3 divide-y divide-slate-100">
            {selfieGaps.map((g) => {
              const t = techById[g.tech_id];
              return (
                <div key={g.event_id} className="flex items-center gap-3 py-2.5">
                  <Avatar name={t?.name || g.tech_id} color={t?.avatar} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-800">
                      {t?.name || g.tech_id}
                      <span className="ml-1.5 font-semibold text-slate-400">
                        · {g.kind === "clock_in" ? "Clock In" : "Clock Out"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {fmtClock(g.server_time)}
                      <span className="ml-1.5">
                        {g.selfie_attached ? (
                          <span className="inline-flex items-center gap-1 text-amber-600">
                            <Upload className="h-3 w-3" /> Upload failed
                          </span>
                        ) : (
                          <span className="text-slate-400">Photo never taken</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Weekly exports the Sunday scheduler generated (server-side, in R2) */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title="Weekly exports"
          sub="Generated automatically every Sunday evening — ready for payroll/ERP"
        />
        {autoExports.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">
            No automatic exports yet — the first one is written this Sunday at 6 PM. The Payroll CSV
            button above downloads the same data on demand.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100">
            {autoExports.map((x) => (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">
                  Week {x.from_date} → {x.to_date}
                </span>
                <span className="text-xs text-slate-400">{x.row_count} rows</span>
                <a
                  href={x.download_url}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" /> CSV
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Monthly grid */}
      <Card className="p-4 md:p-5">
        <SectionHeader
          title={fmtMonthLabel(grid?.month || month)}
          sub="Monthly grid · tap a technician for detail"
          action={
            <div className="flex items-center gap-1">
              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                onClick={() => {
                  const [y, m] = month.split("-").map(Number);
                  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
                  setMonth(prev);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-30"
                disabled={month >= currentMonth()}
                onClick={() => {
                  const [y, m] = month.split("-").map(Number);
                  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
                  setMonth(next);
                }}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          }
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
                          <div className="text-[11px] font-semibold text-slate-500">
                            <span className="text-emerald-600">{row.present}</span>/{row.working}{" "}
                            days
                          </div>
                        </div>
                      </div>
                      {row.cells.map((c) => {
                        const flags = cellFlags(c);
                        return (
                          <div
                            key={c.day}
                            title={`${c.day} · ${c.status}${c.late ? " · late" : ""}${
                              flags.length ? ` · ⚑ ${flags.join(", ")}` : ""
                            }`}
                            className={`relative h-5 w-5 shrink-0 rounded ${ATT_CELL[c.status]}`}
                          >
                            {flags.length > 0 && (
                              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-600 ring-1 ring-white" />
                            )}
                          </div>
                        );
                      })}
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
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full bg-red-600" />
            Evidence flag (hover the day)
          </span>
        </div>
      </Card>
    </div>
  );
}
