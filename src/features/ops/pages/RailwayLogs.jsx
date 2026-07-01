import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import { getRailwayLogs } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import { useServiceSelection } from "@features/ops/hooks/useServiceSelection";
import ServicePicker from "@features/ops/components/ServicePicker";
import ProxyGate from "@features/ops/components/ProxyGate";
import LogViewer from "@features/ops/components/LogViewer";
import { Spinner, ErrorBanner } from "@features/ops/components/States";

export default function RailwayLogs() {
  const { servicesResp, services, selected, setSelected } = useServiceSelection();
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");

  const fetcher = useCallback(
    () => (selected ? getRailwayLogs(selected, { filter, limit: 300 }) : Promise.resolve(null)),
    [selected, filter]
  );
  const { data, error } = usePolling(fetcher, 8000);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Logs</h2>
          <p className="text-sm text-slate-500">
            Tail of the selected service's latest deployment (refreshes every 8s).
          </p>
        </div>
        {servicesResp?.available && (
          <ServicePicker services={services} value={selected} onChange={setSelected} />
        )}
      </header>

      {servicesResp?.available && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setFilter(draft.trim());
          }}
          className="flex items-center gap-2"
        >
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Filter / search log text…"
              className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-900 active:scale-[0.99]"
          >
            Search
          </button>
        </form>
      )}

      {error && <ErrorBanner error={error} />}
      {!servicesResp && <Spinner />}

      <ProxyGate status={servicesResp}>
        <ProxyGate status={data}>{data && <LogViewer lines={data.lines} />}</ProxyGate>
        {!data && <Spinner label="Fetching logs…" />}
      </ProxyGate>
    </div>
  );
}
