import { Phone, Award, CalendarCheck, Wallet, Briefcase } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, SectionHeader } from "@shared/ui/primitives";
import Avatar from "@shared/ui/Avatar";
import { PresenceBadge } from "@shared/ui/StatusChip";
import IntegrationBadge from "@shared/ui/IntegrationBadge";
import { techById } from "@features/technicians/data/technicians";
import { monthSummary } from "@features/attendance/data/attendance";
import { formatPKR } from "@shared/lib/currency";
import { fmtDate } from "@shared/lib/date";

export default function Profile() {
  const { currentTechId, attendanceToday, jobsForTech } = useApp();
  const t = techById(currentTechId);
  const status = attendanceToday[t.id]?.status || t.status;
  const summary = monthSummary(t.id);
  const active = jobsForTech(t.id).length;
  const latest = t.pay[0];

  return (
    <div className="p-4 pb-8 space-y-4">
      {/* Identity */}
      <Card className="p-5 text-center">
        <Avatar name={t.name} color={t.avatar} size="xl" className="mx-auto" />
        <h1 className="mt-3 text-xl font-extrabold tracking-tight text-slate-900">{t.name}</h1>
        <div className="text-sm font-medium text-slate-500">{t.specialty}</div>
        <div className="mt-2 flex items-center justify-center gap-2">
          <PresenceBadge status={status} />
        </div>
        <a
          href={`tel:${t.phone}`}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-3 text-sm font-bold text-white"
        >
          <Phone className="h-4 w-4" /> {t.phone}
        </a>
        <div className="mt-2 text-xs text-slate-400">Joined {fmtDate(t.joinedDate, true)}</div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <Briefcase className="mx-auto h-5 w-5 text-blue-500" />
          <div className="mt-1 text-2xl font-extrabold text-slate-900">{active}</div>
          <div className="text-[11px] font-semibold text-slate-500">Active jobs</div>
        </Card>
        <Card className="p-3 text-center">
          <Award className="mx-auto h-5 w-5 text-emerald-500" />
          <div className="mt-1 text-2xl font-extrabold text-slate-900">{t.perf.completed}</div>
          <div className="text-[11px] font-semibold text-slate-500">Completed</div>
        </Card>
        <Card className="p-3 text-center">
          <CalendarCheck className="mx-auto h-5 w-5 text-amber-500" />
          <div className="mt-1 text-2xl font-extrabold text-slate-900">{summary.present}</div>
          <div className="text-[11px] font-semibold text-slate-500">Days present</div>
        </Card>
      </div>

      {/* Pay summary */}
      <Card className="p-4">
        <SectionHeader
          title="Pay Summary"
          sub={latest.month}
          action={<Wallet className="h-5 w-5 text-slate-300" />}
        />
        <div className="mt-3 rounded-xl bg-slate-900 p-4 text-white">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Net Pay
          </div>
          <div className="text-3xl font-extrabold">{formatPKR(latest.net)}</div>
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Base salary</dt>
            <dd className="font-semibold text-slate-700">{formatPKR(latest.base)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Days worked</dt>
            <dd className="font-semibold text-slate-700">{latest.daysWorked}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Deductions</dt>
            <dd className="font-semibold text-red-500">
              {latest.deductions ? `−${formatPKR(latest.deductions)}` : "—"}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Advances taken</dt>
            <dd className="font-semibold text-amber-600">
              {latest.advances ? `−${formatPKR(latest.advances)}` : "—"}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex justify-center">
          <IntegrationBadge>Synced with Payroll Service</IntegrationBadge>
        </div>
      </Card>
    </div>
  );
}
