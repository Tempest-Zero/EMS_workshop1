import { getMetrics } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import Card from "@features/ops/components/Card";
import ProxyGate from "@features/ops/components/ProxyGate";
import { Spinner, ErrorBanner } from "@features/ops/components/States";
import { fmtMs, fmtPct, fmtUptime } from "@features/ops/lib/format";

function Stat({ label, value, tone = "text-slate-100" }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

const TH = "px-3 py-2 text-right font-semibold";

export default function ApiMetrics() {
  const { data, error, loading } = usePolling(getMetrics, 15000);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-xl font-extrabold tracking-tight text-slate-100">API metrics</h2>
        <p className="text-sm text-slate-500">
          In-process request throughput, error rate and latency percentiles, proxied from the
          backend.
        </p>
      </header>

      {error && <ErrorBanner error={error} />}
      {loading && !data && <Spinner label="Fetching metrics…" />}

      <ProxyGate status={data}>
        {data && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Uptime" value={fmtUptime(data.uptime_seconds)} />
              <Stat label="Total requests" value={data.total_requests.toLocaleString()} />
              <Stat label="In flight" value={data.in_flight} />
              <Stat
                label="Error rate (5xx)"
                value={fmtPct(data.error_rate)}
                tone={data.error_rate > 0 ? "text-red-400" : "text-emerald-400"}
              />
            </div>

            <Card
              title="Routes"
              subtitle="Busiest first · latency percentiles over the recent reservoir"
            >
              {data.routes.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No requests recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 text-left font-semibold">Route</th>
                        <th className={TH}>Count</th>
                        <th className={TH}>4xx</th>
                        <th className={TH}>5xx</th>
                        <th className={TH}>p50</th>
                        <th className={TH}>p95</th>
                        <th className={TH}>p99</th>
                        <th className="py-2 pl-3 text-right font-semibold">max</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {data.routes.map((r) => (
                        <tr key={r.route} className="text-slate-300">
                          <td className="py-2 pr-3 font-mono text-xs text-slate-200">{r.route}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.count.toLocaleString()}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${r.errors_4xx ? "text-amber-300" : "text-slate-600"}`}
                          >
                            {r.errors_4xx}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${r.errors_5xx ? "text-red-400" : "text-slate-600"}`}
                          >
                            {r.errors_5xx}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.p50_ms)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.p95_ms)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.p99_ms)}</td>
                          <td className="py-2 pl-3 text-right tabular-nums">{fmtMs(r.max_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <p className="text-xs leading-relaxed text-slate-600">
              In-memory and per-replica — counters reset on every backend deploy and aren't shared
              across workers. A lightweight stand-in for APM, not a system of record.
            </p>
          </>
        )}
      </ProxyGate>
    </div>
  );
}
