import { useCallback, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getSentryIssues } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";
import Card from "@features/ops/components/Card";
import StatusPill from "@features/ops/components/StatusPill";
import ProxyGate from "@features/ops/components/ProxyGate";
import { Spinner, ErrorBanner } from "@features/ops/components/States";
import { fmtRelative } from "@features/ops/lib/format";

const PROJECTS = [
  { label: "All", value: "" },
  { label: "Web", value: "web" },
  { label: "Backend", value: "backend" },
  { label: "Mobile", value: "mobile" },
];

function levelTone(level) {
  const l = String(level || "").toLowerCase();
  if (l === "fatal" || l === "error") return "down";
  if (l === "warning") return "degraded";
  return "info";
}

export default function SentryIssues() {
  const [project, setProject] = useState("");
  const fetcher = useCallback(() => getSentryIssues(project || undefined), [project]);
  const { data, error } = usePolling(fetcher, 60000);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-tight text-slate-100">Errors</h2>
          <p className="text-sm text-slate-500">Recent unresolved Sentry issues (last 14 days).</p>
        </div>
        <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
          {PROJECTS.map((p) => (
            <button
              key={p.label}
              onClick={() => setProject(p.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${
                project === p.value
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-400 hover:text-slate-100"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      {error && <ErrorBanner error={error} />}
      {!data && <Spinner />}

      <ProxyGate status={data}>
        <Card title="Unresolved issues" subtitle={`${data?.issues?.length ?? 0} shown`}>
          <div className="divide-y divide-slate-800">
            {data?.issues?.map((issue) => (
              <div key={`${issue.project}-${issue.id}`} className="flex items-start gap-3 py-3">
                <StatusPill tone={levelTone(issue.level)}>{issue.level || "issue"}</StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-200">{issue.title}</div>
                  {issue.culprit && (
                    <div className="truncate font-mono text-xs text-slate-500">{issue.culprit}</div>
                  )}
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
                    <span className="uppercase tracking-wide">{issue.project}</span>
                    {issue.count != null && <span>{issue.count} events</span>}
                    {issue.user_count != null && <span>{issue.user_count} users</span>}
                    <span>{fmtRelative(issue.last_seen)}</span>
                  </div>
                </div>
                {issue.permalink && (
                  <a
                    href={issue.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-slate-500 hover:text-slate-200"
                    title="Open in Sentry"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
            {data && data.issues.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-500">
                No unresolved issues. 🎉
              </div>
            )}
          </div>
        </Card>
      </ProxyGate>
    </div>
  );
}
