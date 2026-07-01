import { PlugZap, CloudOff } from "lucide-react";

/**
 * Renders `children` only when a proxied integration (Railway/Sentry) is both
 * configured and reachable. Otherwise it shows WHY — distinguishing "you haven't
 * wired up the token" from "the upstream is down" — so an empty screen is never
 * ambiguous. `status` is the `{ configured, available, detail }` envelope.
 */
export default function ProxyGate({ status, children }) {
  if (!status) return null; // parent shows a loading state
  if (!status.configured) {
    return (
      <Notice
        icon={PlugZap}
        title="Not configured"
        detail={status.detail || "Set the integration's environment variables to enable this tab."}
      />
    );
  }
  if (!status.available) {
    return (
      <Notice
        icon={CloudOff}
        tone="down"
        title="Upstream unavailable"
        detail={
          status.detail || "The upstream service didn't respond. It may be a transient error."
        }
      />
    );
  }
  return children;
}

function Notice({ icon: Icon, title, detail, tone = "neutral" }) {
  const color = tone === "down" ? "text-red-400" : "text-slate-400";
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 px-6 py-12 text-center">
      <Icon className={`h-7 w-7 ${color}`} />
      <div className="mt-2 text-sm font-bold text-slate-200">{title}</div>
      <p className="mt-1 max-w-md text-xs text-slate-500">{detail}</p>
    </div>
  );
}
