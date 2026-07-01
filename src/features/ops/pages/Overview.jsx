import { Link } from "react-router-dom";
import { HeartPulse, Gauge, Server, Bug, ChevronRight } from "lucide-react";
import {
  getHealth,
  getMetrics,
  getRailwayServices,
  getSentryIssues,
} from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import Card from "@features/ops/components/Card";
import StatusPill from "@features/ops/components/StatusPill";
import { fmtRelative, fmtPct } from "@features/ops/lib/format";

function Tile({ to, icon: Icon, label, value, pill }) {
  return (
    <Link
      to={to}
      className="group rounded-2xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-700 hover:bg-slate-800/60"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-slate-500" />
        <ChevronRight className="h-4 w-4 text-slate-600 transition group-hover:translate-x-0.5" />
      </div>
      <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-extrabold text-slate-100">{value}</span>
        {pill}
      </div>
    </Link>
  );
}

export default function Overview() {
  const { data: health } = usePolling(getHealth, 15000);
  const { data: metrics } = usePolling(getMetrics, 15000);
  const { data: servicesResp } = usePolling(getRailwayServices, 60000);
  const { data: sentry } = usePolling(getSentryIssues, 60000);

  const services = servicesResp?.services ?? [];
  const upServices = services.filter(
    (s) => String(s.latest_status).toUpperCase() === "SUCCESS"
  ).length;

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Overview</h2>
        <p className="text-sm text-slate-500">
          Production at a glance — health, deployments, logs and errors.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          to="/health"
          icon={HeartPulse}
          label="System health"
          value={health ? "" : "—"}
          pill={health && <StatusPill status={health.status}>{health.status}</StatusPill>}
        />
        <Tile
          to="/metrics"
          icon={Gauge}
          label="API error rate"
          value={metrics?.available ? fmtPct(metrics.error_rate) : "—"}
          pill={
            metrics?.available && (
              <StatusPill tone={metrics.error_rate > 0 ? "down" : "ok"}>
                {metrics.total_requests.toLocaleString()} req
              </StatusPill>
            )
          }
        />
        <Tile
          to="/deployments"
          icon={Server}
          label="Services up"
          value={servicesResp?.available ? `${upServices}/${services.length}` : "—"}
        />
        <Tile
          to="/errors"
          icon={Bug}
          label="Open errors"
          value={sentry?.available ? (sentry.issues?.length ?? 0) : "—"}
        />
      </div>

      <Card title="Services" subtitle="Latest deployment status per Railway service">
        {!servicesResp?.available ? (
          <p className="py-4 text-sm text-slate-500">
            {servicesResp && !servicesResp.configured
              ? "Railway API not configured."
              : "Loading service status…"}
          </p>
        ) : (
          <div className="divide-y divide-slate-800">
            {services.map((s) => (
              <div key={s.id || s.name} className="flex items-center gap-3 py-2.5">
                <span className="font-semibold text-slate-200">{s.name}</span>
                <span className="ml-auto text-xs text-slate-500">{fmtRelative(s.latest_at)}</span>
                <StatusPill status={s.latest_status}>{s.latest_status || "—"}</StatusPill>
              </div>
            ))}
            {services.length === 0 && (
              <p className="py-4 text-sm text-slate-500">No services reported.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
