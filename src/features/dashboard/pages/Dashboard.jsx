import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  ClipboardList,
  PackageSearch,
  Wallet,
  Clock3,
  UserX,
  ChevronRight,
} from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import StatCard from "@shared/ui/StatCard";
import { Card, SectionHeader } from "@shared/ui/primitives";
import { formatPKR } from "@shared/lib/currency";
import { amountPaid } from "@shared/lib/job";
import { daysSince, parseISO } from "@shared/lib/date";
import { weekDays } from "@features/schedule/data/schedule";

const ON_DUTY = ["present", "field", "half"];

function kindDot(kind) {
  const map = {
    create: "bg-blue-500",
    assign: "bg-slate-400",
    note: "bg-slate-400",
    estimate: "bg-amber-500",
    approve: "bg-emerald-500",
    approved: "bg-emerald-500",
    declined: "bg-red-500",
    ready: "bg-emerald-500",
    payment: "bg-emerald-600",
    status: "bg-slate-500",
    followup: "bg-amber-500",
  };
  return map[kind] || "bg-slate-300";
}

export default function Dashboard() {
  const { jobs, technicians, attendanceToday, globalActivity } = useApp();
  const nav = useNavigate();

  const stats = useMemo(() => {
    const present = technicians.filter((t) =>
      ON_DUTY.includes(attendanceToday[t.id]?.status)
    ).length;
    const active = jobs.filter((j) => j.status !== "closed").length;
    const awaitingParts = jobs.filter(
      (j) => j.status === "waiting" && /part/i.test(j.waitingReason || "")
    ).length;

    const weekStart = parseISO(weekDays[0].date);
    let revenue = 0;
    jobs.forEach((j) => {
      const pay = (j.timeline || []).find((e) => e.kind === "payment");
      if (pay && parseISO(pay.ts) >= weekStart) revenue += amountPaid(j);
    });
    return { present, active, awaitingParts, revenue };
  }, [jobs, technicians, attendanceToday]);

  const alerts = useMemo(() => {
    const out = [];
    const agingReady = jobs.filter((j) => j.status === "ready" && daysSince(j.readySince) >= 4);
    if (agingReady.length) {
      out.push({
        id: "aging",
        icon: Clock3,
        tone: "amber",
        title: `${agingReady.length} repaired ${
          agingReady.length === 1 ? "job" : "jobs"
        } awaiting pickup 4+ days`,
        sub: agingReady
          .map((j) => `#${j.token} · ${j.customer.name} (${daysSince(j.readySince)}d)`)
          .join("   "),
        to: "/jobs?status=ready",
      });
    }
    const absent = technicians.filter((t) => attendanceToday[t.id]?.status === "absent");
    if (absent.length) {
      out.push({
        id: "absent",
        icon: UserX,
        tone: "red",
        title: `${absent.length} technician${absent.length === 1 ? "" : "s"} absent today`,
        sub: absent.map((t) => t.name).join(", "),
        to: "/attendance",
      });
    }
    return out;
  }, [jobs, technicians, attendanceToday]);

  const recent = globalActivity.slice(0, 10);

  const toneRing = {
    amber: "border-amber-200 bg-amber-50",
    blue: "border-blue-200 bg-blue-50",
    red: "border-red-200 bg-red-50",
  };
  const toneIcon = {
    amber: "text-amber-500",
    blue: "text-blue-500",
    red: "text-red-500",
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Present Today"
          value={`${stats.present}/${technicians.length}`}
          sub="Technicians on duty"
          tone={stats.present >= technicians.length ? "green" : "red"}
          icon={Users}
          onClick={() => nav("/attendance")}
        />
        <StatCard
          label="Active Jobs"
          value={stats.active}
          sub="Open · Waiting · Ready"
          tone="blue"
          icon={ClipboardList}
          onClick={() => nav("/jobs")}
        />
        <StatCard
          label="Awaiting Parts"
          value={stats.awaitingParts}
          sub="Blocked on supplier"
          tone="amber"
          icon={PackageSearch}
          onClick={() => nav("/jobs?status=waiting")}
        />
        <StatCard
          label="Revenue This Week"
          value={formatPKR(stats.revenue)}
          sub="Payments collected"
          tone="green"
          icon={Wallet}
        />
      </div>

      {/* Alerts strip */}
      <Card className="p-4">
        <SectionHeader
          title="Needs Attention"
          sub={alerts.length ? "Tap an alert to jump to the affected jobs" : undefined}
        />
        <div className="mt-3 space-y-2">
          {alerts.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-medium text-slate-400">
              All clear — nothing needs attention right now.
            </div>
          )}
          {alerts.map((a) => {
            const Icon = a.icon;
            return (
              <Link
                key={a.id}
                to={a.to}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition hover:shadow-sm ${toneRing[a.tone]}`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${toneIcon[a.tone]}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-800">{a.title}</div>
                  {a.sub && (
                    <div className="truncate text-xs font-medium text-slate-500">{a.sub}</div>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </Link>
            );
          })}
        </div>
      </Card>

      {/* Recent activity */}
      <Card className="p-4">
        <SectionHeader title="Recent Activity" sub="Latest updates across all jobs" />
        <ul className="mt-3 divide-y divide-slate-100">
          {recent.map((e, i) => {
            return (
              <li key={`${e.jobId}-${i}`}>
                <Link
                  to={`/jobs/${e.jobId}`}
                  className="flex items-start gap-3 py-2.5 transition hover:bg-slate-50 -mx-2 px-2 rounded-lg"
                >
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${kindDot(e.kind)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-700">
                      <span className="font-bold text-slate-900">#{e.jobToken}</span> {e.text}
                    </div>
                    <div className="text-xs text-slate-400">{e.label}</div>
                  </div>
                </Link>
              </li>
            );
          })}
          {recent.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">No activity yet.</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
