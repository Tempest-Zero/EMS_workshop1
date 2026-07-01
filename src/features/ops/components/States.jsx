import { Loader2, WifiOff } from "lucide-react";

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

/** Surfaced when the backend call itself failed (network/401/5xx) — distinct from
 *  a proxy's "unavailable" (which ProxyGate handles). */
export function ErrorBanner({ error }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Couldn't reach the ops API. {error?.message ? `(${error.message})` : ""}
      </span>
    </div>
  );
}
