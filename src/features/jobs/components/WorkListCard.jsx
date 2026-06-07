/**
 * A card in the unassigned Work List (Module 2 dual assignment). Shows both
 * paths simultaneously: a technician can **Claim** it (free-pick) or a manager
 * can **Assign to…** a specific technician.
 */

import { Link } from "react-router-dom";
import { Home, Hand } from "lucide-react";
import { useApp } from "@app/providers/AppContext";
import { Card, Button } from "@shared/ui/primitives";
import StatusChip from "@shared/ui/StatusChip";

export default function WorkListCard({ job }) {
  const { technicians, currentTechId, claimJob, assignJob } = useApp();
  const isVisit = job.jobType === "home-visit";

  return (
    <Card className="flex flex-col p-4">
      <Link to={`/jobs/${job.id}`} className="block">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-extrabold tracking-tight text-slate-900">
              #{job.token}
            </span>
            <StatusChip status={job.status} />
          </div>
          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            {isVisit ? <Home className="h-3 w-3" /> : null}
            {isVisit ? "Home Visit" : "Carry-in"}
          </span>
        </div>
        <div className="mt-1 truncate text-sm font-bold text-slate-800">{job.customer.name}</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {job.appliance.type} · {job.appliance.brand}
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-slate-600">{job.problem}</p>
      </Link>

      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
        <Button size="sm" variant="primary" onClick={() => claimJob(job.id, currentTechId)}>
          <Hand className="h-4 w-4" /> Claim
        </Button>
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) assignJob(job.id, e.target.value);
          }}
          aria-label="Assign to technician"
          className="flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-semibold text-slate-700 focus:border-slate-400 focus:outline-none"
        >
          <option value="" disabled>
            Assign to…
          </option>
          {technicians.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </Card>
  );
}
