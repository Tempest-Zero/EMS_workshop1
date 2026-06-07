import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, ClipboardList } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import JobCard from "@features/jobs/components/JobCard";
import WorkListCard from "@features/jobs/components/WorkListCard";
import { Button, EmptyState } from "@shared/ui/primitives";
import { SlideOver } from "@shared/ui/Overlay";
import NewJobForm from "@features/jobs/components/NewJobForm";
import { statusConfig } from "@shared/lib/statusConfig";
import { isUnassigned } from "@shared/lib/job";

const TABS = [
  { key: "all", label: "All Active" },
  { key: "unassigned", label: "Unassigned" },
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting" },
  { key: "ready", label: "Ready" },
  { key: "history", label: "History" },
];

export default function JobsBoard() {
  const { jobs, addJob, addToast } = useApp();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const initial = params.get("status");
  const [tab, setTab] = useState(TABS.some((t) => t.key === initial) ? initial : "all");
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const counts = useMemo(() => {
    const c = { all: 0, unassigned: 0, open: 0, waiting: 0, ready: 0, history: 0 };
    jobs.forEach((j) => {
      if (j.status === "closed") c.history += 1;
      else {
        c.all += 1;
        c[j.status] += 1;
        if (isUnassigned(j)) c.unassigned += 1;
      }
    });
    return c;
  }, [jobs]);

  const visible = useMemo(() => {
    let list = jobs.filter((j) =>
      tab === "history"
        ? j.status === "closed"
        : tab === "unassigned"
          ? j.status !== "closed" && isUnassigned(j)
          : tab === "all"
            ? j.status !== "closed"
            : j.status === tab
    );
    const term = q.trim().toLowerCase();
    if (term) {
      list = list.filter((j) =>
        [
          j.token,
          j.customer.name,
          j.appliance.type,
          j.appliance.brand,
          j.appliance.model,
          j.problem,
        ]
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    }
    // Sort: oldest-first for waiting/ready (aging surfaces), newest-first otherwise.
    return list.sort((a, b) => b.token - a.token);
  }, [jobs, tab, q]);

  const selectTab = (key) => {
    setTab(key);
    if (key === "all" || key === "history") setParams({});
    else setParams({ status: key });
  };

  const handleCreate = async (form) => {
    try {
      const job = await addJob(form);
      setNewOpen(false);
      addToast(`Job #${job.token} created`, "ready");
      nav(`/jobs/${job.id}`);
    } catch {
      addToast("Couldn't create job — try again", "danger");
    }
  };

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search token, customer, appliance…"
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <Button variant="primary" onClick={() => setNewOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4" />
          New Job
        </Button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.key;
          const dot = statusConfig[t.key]?.dot;
          return (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50"
              }`}
            >
              {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
              {t.label}
              <span
                className={`rounded-full px-1.5 text-xs font-bold ${
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {counts[t.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Work-list hint */}
      {tab === "unassigned" && visible.length > 0 && (
        <p className="-mt-2 text-sm text-slate-500">
          Unassigned jobs — a technician can <span className="font-semibold">Claim</span> one, or a
          manager can <span className="font-semibold">Assign</span> it.
        </p>
      )}

      {/* Grid */}
      {visible.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((j) =>
            tab === "unassigned" ? (
              <WorkListCard key={j.id} job={j} />
            ) : (
              <JobCard key={j.id} job={j} />
            )
          )}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={tab === "unassigned" ? "No unassigned jobs" : "No jobs here"}
          sub={
            tab === "unassigned"
              ? "New jobs created without a technician land here for pickup."
              : q
                ? "Try a different search term."
                : "Jobs in this status will appear here."
          }
        />
      )}

      <SlideOver
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New Job"
        subtitle="Log a carry-in or schedule a home visit"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form={NewJobForm.FORM_ID}>
              Create Job
            </Button>
          </div>
        }
      >
        <NewJobForm onSubmit={handleCreate} />
      </SlideOver>
    </div>
  );
}
