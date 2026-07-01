import { getHealth } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import Card from "@features/ops/components/Card";
import StatusPill from "@features/ops/components/StatusPill";
import { Spinner, ErrorBanner } from "@features/ops/components/States";
import { fmtMs } from "@features/ops/lib/format";

export default function Health() {
  const { data, error, loading } = usePolling(getHealth, 15000);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Deep health</h2>
          <p className="text-sm text-slate-500">
            Live dependency probes — DB, storage, scheduler, migrations, config.
          </p>
        </div>
        {data && <StatusPill status={data.status}>{data.status}</StatusPill>}
      </header>

      {error && <ErrorBanner error={error} />}
      {loading && !data && <Spinner />}

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.components.map((c) => (
            <Card
              key={c.name}
              title={c.name}
              action={<StatusPill status={c.status}>{c.status}</StatusPill>}
            >
              <div className="space-y-1">
                {c.latency_ms != null && (
                  <div className="text-2xl font-bold text-slate-100">{fmtMs(c.latency_ms)}</div>
                )}
                {c.detail && <p className="text-xs leading-relaxed text-slate-400">{c.detail}</p>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
