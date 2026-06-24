import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Briefcase, ChevronRight, Hand, Loader2, Wrench } from "lucide-react";
import { useAuth } from "@app/providers/AuthContext";
import { fetchJobs, claimJob } from "@features/jobs/data/jobsApi";

export default function TechJobsList() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState(null);

  const loadJobs = useCallback(() => {
    setLoading(true);
    // Fetch all active/open jobs to sort client-side
    fetchJobs({ status: "open" })
      .then((data) => setJobs(data || []))
      .catch((err) => console.error("Failed to load jobs", err))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleClaim = async (jobId) => {
    setClaimingId(jobId);
    try {
      await claimJob(jobId);
      loadJobs(); // Refresh the list so it moves to "My Tasks"
    } catch (error) {
      alert("Failed to claim job. Someone else might have grabbed it!");
    } finally {
      setClaimingId(null);
    }
  };

  // Split the jobs into Assigned vs Unassigned
  const myTasks = jobs.filter((j) => j.assigned_tech_id === user?.tech_id);
  const availableTasks = jobs.filter((j) => !j.assigned_tech_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── SECTION 1: MY ACTIVE TASKS ── */}
      <div>
        <h2 className="px-1 mb-3 text-sm font-bold tracking-wide text-slate-800 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-slate-500" /> My Assigned Tasks
        </h2>
        
        {myTasks.length === 0 ? (
          <div className="p-6 text-center text-sm font-medium text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white/50">
            You have no active assignments.
          </div>
        ) : (
          <div className="grid gap-3">
            {myTasks.map((job) => (
              <Link
                key={job.id}
                to={`/my-jobs/${job.id}`}
                className="flex items-center justify-between p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm active:scale-[0.98] transition-transform"
              >
                <div>
                  <div className="text-xs font-bold text-indigo-600 mb-0.5">#{job.id.substring(0, 5).toUpperCase()}</div>
                  <div className="text-sm font-bold text-slate-900">{job.customer_name || "Walk-in Customer"}</div>
                  <div className="text-xs font-medium text-slate-500 mt-0.5">{job.device_model || "Appliance Repair"}</div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2: AVAILABLE TO CLAIM ── */}
      <div className="pt-2">
        <h2 className="px-1 mb-3 text-sm font-bold tracking-wide text-slate-800 flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-slate-500" /> Available Pool
        </h2>

        {availableTasks.length === 0 ? (
          <div className="p-6 text-center text-sm font-medium text-slate-400 border border-slate-200 rounded-2xl bg-slate-50">
            No unassigned jobs currently in the queue.
          </div>
        ) : (
          <div className="grid gap-3">
            {availableTasks.map((job) => (
              <div
                key={job.id}
                className="p-4 bg-white border border-slate-200/80 rounded-2xl shadow-sm flex flex-col gap-3"
              >
                <div>
                  <div className="text-xs font-bold text-slate-400 mb-0.5">#{job.id.substring(0, 5).toUpperCase()}</div>
                  <div className="text-sm font-bold text-slate-900">{job.customer_name || "Walk-in Customer"}</div>
                  <div className="text-xs font-medium text-slate-500 mt-0.5">{job.device_model || "Appliance Repair"}</div>
                </div>
                
                <button
                  onClick={() => handleClaim(job.id)}
                  disabled={claimingId === job.id}
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-900 text-white text-sm font-bold rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  {claimingId === job.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Hand className="w-4 h-4" />
                  )}
                  Claim Job
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}