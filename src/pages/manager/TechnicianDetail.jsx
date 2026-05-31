import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Phone, CalendarCheck, Award, Wallet } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Card, SectionHeader, Button, EmptyState } from "../../components/primitives";
import Avatar from "../../components/Avatar";
import StatusChip, { PresenceBadge } from "../../components/StatusChip";
import IntegrationBadge from "../../components/IntegrationBadge";
import MonthDots from "../../components/MonthDots";
import { techById } from "../../data/technicians";
import { monthSummary } from "../../data/attendance";
import { formatPKR } from "../../lib/currency";
import { fmtDate } from "../../lib/date";
import { amountOwed } from "../../lib/job";

export default function TechnicianDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { attendanceToday, jobsForTech } = useApp();
  const t = techById(id);

  if (!t) {
    return (
      <div>
        <EmptyState title="Technician not found" />
        <div className="mt-4 text-center">
          <Button onClick={() => nav("/technicians")}>Back</Button>
        </div>
      </div>
    );
  }

  const status = attendanceToday[t.id]?.status || t.status;
  const summary = monthSummary(t.id);
  const jobs = jobsForTech(t.id);

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
            <div className="mt-2 flex items-center gap-2">
              <PresenceBadge status={status} />
              <span className="text-xs text-slate-400">Joined {fmtDate(t.joinedDate, true)}</span>
            </div>
          </div>
          <a href={`tel:${t.phone}`}>
            <Button variant="primary">
              <Phone className="h-4 w-4" /> {t.phone}
            </Button>
          </a>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Attendance */}
        <Card className="p-5">
          <SectionHeader
            title="Attendance — May 2026"
            action={<IntegrationBadge>Synced with Attendance Service</IntegrationBadge>}
          />
          <div className="mt-3 flex items-center gap-4">
            <div className="rounded-xl bg-emerald-50 px-4 py-2 text-center">
              <div className="text-2xl font-extrabold text-emerald-700">{summary.present}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-500">Present</div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-2 text-center">
              <div className="text-2xl font-extrabold text-slate-700">{summary.working}</div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Working days</div>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <CalendarCheck className="h-4 w-4 text-slate-400" />
              {Math.round((summary.present / summary.working) * 100)}% rate
            </div>
          </div>
          <div className="mt-4">
            <MonthDots techId={t.id} showNums />
          </div>
        </Card>

        {/* Performance */}
        <Card className="p-5">
          <SectionHeader title="Performance" sub="This month" />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-100 p-4">
              <Award className="h-5 w-5 text-blue-500" />
              <div className="mt-2 text-3xl font-extrabold text-slate-900">{t.perf.completed}</div>
              <div className="text-xs font-semibold text-slate-500">Jobs completed</div>
            </div>
            <div className="rounded-xl border border-slate-100 p-4">
              <CalendarCheck className="h-5 w-5 text-emerald-500" />
              <div className="mt-2 text-3xl font-extrabold text-slate-900">{t.perf.avgDays}</div>
              <div className="text-xs font-semibold text-slate-500">Avg days / job</div>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
            {jobs.length} active {jobs.length === 1 ? "job" : "jobs"} right now
          </div>
        </Card>
      </div>

      {/* Current jobs */}
      <Card className="p-5">
        <SectionHeader title="Current Jobs" />
        {jobs.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link to={`/jobs/${j.id}`} className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-slate-50">
                  <span className="text-sm font-extrabold text-slate-900">#{j.token}</span>
                  <StatusChip status={j.status} />
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                    {j.customer.name} · {j.appliance.type}
                  </span>
                  <span className="text-sm font-bold text-slate-700">
                    {amountOwed(j) ? formatPKR(amountOwed(j)) : "—"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No active jobs assigned.</p>
        )}
      </Card>

      {/* Pay table */}
      <Card className="p-5">
        <SectionHeader
          title="Payroll"
          sub="Last 3 months"
          action={<IntegrationBadge>Synced with Payroll Service</IntegrationBadge>}
        />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                <th className="pb-2">Month</th>
                <th className="pb-2 text-right">Base</th>
                <th className="pb-2 text-center">Days</th>
                <th className="pb-2 text-right">Deductions</th>
                <th className="pb-2 text-right">Advances</th>
                <th className="pb-2 text-right">Net Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {t.pay.map((p) => (
                <tr key={p.month}>
                  <td className="py-2.5 font-semibold text-slate-700">{p.month}</td>
                  <td className="py-2.5 text-right text-slate-600">{formatPKR(p.base)}</td>
                  <td className="py-2.5 text-center text-slate-600">{p.daysWorked}</td>
                  <td className="py-2.5 text-right text-red-500">{p.deductions ? `−${formatPKR(p.deductions)}` : "—"}</td>
                  <td className="py-2.5 text-right text-amber-600">{p.advances ? `−${formatPKR(p.advances)}` : "—"}</td>
                  <td className="py-2.5 text-right font-extrabold text-slate-900">{formatPKR(p.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
