/**
 * One technician, manager view — built entirely from live data: the roster
 * (useApp), this month's attendance (/api/attendance/grid), and the real jobs
 * list. The prototype's fabricated payroll table, invented performance stats,
 * and static May-2026 month were removed — payroll truth lives in the
 * Attendance page's CSV export until a real payroll integration exists.
 */

import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, CalendarCheck, Award } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, SectionHeader, Button, EmptyState } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import StatusChip, { PresenceBadge } from "@shared/ui/StatusChip";
import MonthDots from "@features/attendance/components/MonthDots";
import { fetchGrid } from "@features/attendance/data/attendanceApi";
import { formatPKR } from "@shared/lib/currency";
import { fmtDate } from "@shared/lib/date";
import { amountOwed } from "@shared/lib/job";
import { TODAY } from "@shared/config/constants";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function TechnicianDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { technicians, attendanceToday, jobsForTech, jobs } = useApp();
  const t = technicians.find((tech) => tech.id === id);

  // This month's attendance for this tech, straight from the live grid API.
  const month = TODAY.slice(0, 7); // YYYY-MM
  const [grid, setGrid] = useState(null); // { present, working, cells } | null
  useEffect(() => {
    if (!t) return undefined;
    let cancelled = false;
    fetchGrid(month, [t.id])
      .then((g) => {
        if (!cancelled) setGrid(g?.rows?.[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setGrid(null);
      });
    return () => {
      cancelled = true;
    };
  }, [t, month]);

  if (!t) {
    return (
      <div>
        <EmptyState
          title="Technician not found"
          sub="The roster may still be loading, or this person is no longer active."
        />
        <div className="mt-4 text-center">
          <Button onClick={() => nav("/technicians")}>Back</Button>
        </div>
      </div>
    );
  }

  const status = attendanceToday[t.id]?.status || "absent";
  const activeJobs = jobsForTech(t.id);
  const closedJobs = jobs.filter((j) => j.assignedTechId === t.id && j.status === "closed");
  const monthLabel = `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

  return (
    <div className="space-y-5">
      <button
        onClick={() => nav("/technicians")}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> Technicians
      </button>

      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Avatar name={t.name} color={t.avatar} size="xl" />
          <div className="flex-1">
            <h1 className="text-xl font-extrabold tracking-tight text-slate-900">{t.name}</h1>
            <div className="text-sm font-medium text-slate-500">{t.specialty}</div>
            <div className="mt-2">
              <PresenceBadge status={status} />
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Attendance — live grid for the current month */}
        <Card className="p-5">
          <SectionHeader title={`Attendance — ${monthLabel}`} />
          {grid ? (
            <>
              <div className="mt-3 flex items-center gap-4">
                <div className="rounded-xl bg-emerald-50 px-4 py-2 text-center">
                  <div className="text-2xl font-extrabold text-emerald-700">{grid.present}</div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-500">
                    Present
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-2 text-center">
                  <div className="text-2xl font-extrabold text-slate-700">{grid.working}</div>
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Working days
                  </div>
                </div>
                {grid.working > 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <CalendarCheck className="h-4 w-4 text-slate-400" />
                    {Math.round((grid.present / grid.working) * 100)}% rate
                  </div>
                )}
              </div>
              <div className="mt-4">
                <MonthDots cells={grid.cells} showNums />
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-slate-400">Loading attendance…</p>
          )}
        </Card>

        {/* Work — counted from the real jobs list */}
        <Card className="p-5">
          <SectionHeader title="Work" sub="From the live jobs list" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 p-4">
              <Award className="h-5 w-5 text-blue-500" />
              <div className="mt-2 text-3xl font-extrabold text-slate-900">{closedJobs.length}</div>
              <div className="text-xs font-semibold text-slate-500">Jobs closed</div>
            </div>
            <div className="rounded-xl border border-slate-100 p-4">
              <CalendarCheck className="h-5 w-5 text-emerald-500" />
              <div className="mt-2 text-3xl font-extrabold text-slate-900">{activeJobs.length}</div>
              <div className="text-xs font-semibold text-slate-500">Active right now</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Current jobs */}
      <Card className="p-5">
        <SectionHeader title="Current Jobs" />
        {activeJobs.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {activeJobs.map((j) => (
              <li key={j.id}>
                <Link
                  to={`/jobs/${j.id}`}
                  className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-slate-50"
                >
                  <span className="text-sm font-extrabold text-slate-900">#{j.token}</span>
                  <StatusChip status={j.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                    {j.customer.name} · {j.appliance.type}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {amountOwed(j) ? formatPKR(amountOwed(j)) : "—"}
                  </span>
                  <span className="text-xs text-slate-400">{fmtDate(j.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No active jobs assigned.</p>
        )}
      </Card>
    </div>
  );
}
