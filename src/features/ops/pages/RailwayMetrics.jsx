import { useCallback, useState } from "react";
import { getRailwayMetrics } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import { useServiceSelection } from "@features/ops/hooks/useServiceSelection";
import ServicePicker from "@features/ops/components/ServicePicker";
import ProxyGate from "@features/ops/components/ProxyGate";
import MetricChart from "@features/ops/components/MetricChart";
import { Spinner, ErrorBanner } from "@features/ops/components/States";

const RANGES = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
];

export default function RailwayMetrics() {
  const { servicesResp, services, selected, setSelected } = useServiceSelection();
  const [hours, setHours] = useState(6);

  const fetcher = useCallback(
    () => (selected ? getRailwayMetrics(selected, hours) : Promise.resolve(null)),
    [selected, hours]
  );
  const { data, error } = usePolling(fetcher, 30000);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Resources</h2>
          <p className="text-sm text-slate-500">CPU, memory and network usage per service.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.hours}
                onClick={() => setHours(r.hours)}
                className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                  hours === r.hours
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {servicesResp?.available && (
            <ServicePicker services={services} value={selected} onChange={setSelected} />
          )}
        </div>
      </header>

      {error && <ErrorBanner error={error} />}
      {!servicesResp && <Spinner />}

      <ProxyGate status={servicesResp}>
        <ProxyGate status={data}>
          {data && data.series.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.series.map((s) => (
                <MetricChart key={s.measurement} series={s} />
              ))}
            </div>
          ) : (
            data && (
              <div className="rounded-lg border border-dashed border-slate-800 px-4 py-10 text-center text-sm text-slate-500">
                No metric series returned for this service/range.
              </div>
            )
          )}
        </ProxyGate>
        {!data && <Spinner label="Fetching metrics…" />}
      </ProxyGate>
    </div>
  );
}
