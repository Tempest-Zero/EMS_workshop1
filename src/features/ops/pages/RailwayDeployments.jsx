import { useCallback } from "react";
import { GitCommitHorizontal } from "lucide-react";
import { getRailwayDeployments } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import { useServiceSelection } from "@features/ops/hooks/useServiceSelection";
import Card from "@features/ops/components/Card";
import StatusPill from "@features/ops/components/StatusPill";
import ServicePicker from "@features/ops/components/ServicePicker";
import ProxyGate from "@features/ops/components/ProxyGate";
import { Spinner, ErrorBanner } from "@features/ops/components/States";
import { fmtRelative } from "@features/ops/lib/format";

export default function RailwayDeployments() {
  const { servicesResp, services, selected, setSelected } = useServiceSelection();
  const fetcher = useCallback(
    () => (selected ? getRailwayDeployments(selected) : Promise.resolve(null)),
    [selected]
  );
  const { data, error } = usePolling(fetcher, 30000);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Deployments</h2>
          <p className="text-sm text-slate-500">Recent Railway deployments per service.</p>
        </div>
        {servicesResp?.available && (
          <ServicePicker services={services} value={selected} onChange={setSelected} />
        )}
      </header>

      {error && <ErrorBanner error={error} />}
      {!servicesResp && <Spinner />}

      <ProxyGate status={servicesResp}>
        <ProxyGate status={data}>
          <Card title={selected} subtitle="newest first">
            <div className="divide-y divide-slate-800">
              {data?.deployments?.map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-3">
                  <StatusPill status={d.status}>{d.status}</StatusPill>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm text-slate-300">
                      <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      <span className="truncate">{d.commit_message || "(no commit message)"}</span>
                    </div>
                    {d.commit_sha && (
                      <span className="font-mono text-xs text-slate-500">
                        {d.commit_sha.slice(0, 9)}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-slate-500">
                    {fmtRelative(d.created_at)}
                  </span>
                </div>
              ))}
              {data && data.deployments.length === 0 && (
                <div className="py-6 text-center text-sm text-slate-500">No deployments found.</div>
              )}
            </div>
          </Card>
        </ProxyGate>
        {!data && <Spinner />}
      </ProxyGate>
    </div>
  );
}
