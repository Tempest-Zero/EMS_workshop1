import { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import { useAuth } from "@app/providers/AuthContext";
import { fetchJobs, createJob } from "@features/jobs/data/jobsApi";
import { mapApiJob, toCreateBody } from "@features/jobs/data/mapJob";
import { technicians } from "@features/technicians/data/technicians";
import { todayRecord } from "@features/attendance/data/attendance";
import { TODAY } from "@shared/config/constants";
import { nowEntry, fmtTime } from "@shared/lib/date";
import { estimateTotal } from "@shared/lib/job";

const RATE = 1200;

const AppContext = createContext(null);

function initAttendanceToday() {
  const map = {};
  technicians.forEach((t) => {
    const rec = todayRecord(t.id) || { status: "absent", clockIn: null, clockOut: null };
    map[t.id] = {
      status: rec.status,
      clockIn: rec.clockIn,
      clockOut: rec.clockOut,
      clockedIn: ["present", "field", "half"].includes(rec.status) && !rec.clockOut,
    };
  });
  return map;
}

export function AppProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [currentTechId, setCurrentTechId] = useState("t1");
  const [attendanceToday, setAttendanceToday] = useState(initAttendanceToday);
  const [toasts, setToasts] = useState([]);

  // Load the real jobs once the user is logged in (the API requires a token).
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    fetchJobs()
      .then((rows) => {
        if (!cancelled) setJobs(rows.map(mapApiJob));
      })
      .catch(() => {
        /* leave jobs empty; screens show their empty states */
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const addToast = useCallback((message, tone = "default") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const patchJob = useCallback((jobId, updater, entry) => {
    setJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const next = typeof updater === "function" ? updater(j) : { ...j, ...updater };
        if (entry) next.timeline = [...(next.timeline || []), entry];
        return next;
      })
    );
  }, []);

  // Real create: POST to the API, then prepend the mapped job. Returns the new
  // job so the caller can navigate to it / toast its token.
  const addJob = useCallback(async (form) => {
    const created = await createJob(toCreateBody(form));
    const job = mapApiJob(created);
    setJobs((prev) => [job, ...prev]);
    return job;
  }, []);

  const addNote = useCallback(
    (jobId, text, byName = "Technician") => {
      const e = nowEntry(`${byName} added note: ${text}`, "note");
      patchJob(
        jobId,
        (j) => ({ ...j, notes: [...(j.notes || []), { label: e.label, by: byName, text }] }),
        e
      );
    },
    [patchJob]
  );

  const setEstimate = useCallback(
    (jobId, { parts, laborHours, laborRate }) => {
      const est = { status: "estimated", parts, laborHours, laborRate: laborRate || RATE };
      const total = estimateTotal(est);
      patchJob(
        jobId,
        (j) => ({ ...j, estimate: est }),
        nowEntry(
          `Estimate set: Rs ${total.toLocaleString("en-PK")} — awaiting approval`,
          "estimate"
        )
      );
    },
    [patchJob]
  );

  const addEstimateLineItem = useCallback(
    (jobId, part) => {
      patchJob(
        jobId,
        (j) => {
          const prev = j.estimate || { status: "none", parts: [], laborHours: 0, laborRate: RATE };
          return {
            ...j,
            estimate: {
              ...prev,
              status: prev.status === "none" ? "estimated" : prev.status,
              parts: [...(prev.parts || []), part],
            },
          };
        },
        nowEntry(`Part added from troubleshooting: ${part.name}`, "estimate")
      );
    },
    [patchJob]
  );

  const setEstimateStatus = useCallback(
    (jobId, status) => {
      patchJob(
        jobId,
        (j) => ({ ...j, estimate: { ...j.estimate, status } }),
        nowEntry(
          status === "approved" ? "Customer approved estimate" : "Customer declined estimate",
          status
        )
      );
    },
    [patchJob]
  );

  const markReady = useCallback(
    (jobId) => {
      patchJob(
        jobId,
        (j) => ({ ...j, status: "ready", readySince: TODAY }),
        nowEntry("Marked Ready — SMS sent to customer", "ready")
      );
      addToast("SMS notification sent to customer", "ready");
    },
    [patchJob, addToast]
  );

  const logPayment = useCallback(
    (jobId, { amount, method }) => {
      patchJob(
        jobId,
        (j) => ({
          ...j,
          payment: { method, paid: (j.payment?.paid || 0) + Number(amount) },
        }),
        nowEntry(
          `Payment logged: Rs ${Number(amount).toLocaleString("en-PK")} (${method})`,
          "payment"
        )
      );
      addToast("Payment recorded", "ready");
    },
    [patchJob, addToast]
  );

  const closeJob = useCallback(
    (jobId) => {
      patchJob(
        jobId,
        (j) => ({ ...j, status: "closed", closedAt: TODAY }),
        nowEntry("Job closed", "status")
      );
      addToast("Job closed and moved to history", "default");
    },
    [patchJob, addToast]
  );

  const followUp = useCallback(
    (jobId, text) => {
      const e = nowEntry(`Follow-up: ${text}`, "followup");
      patchJob(
        jobId,
        (j) => ({ ...j, followUps: [...(j.followUps || []), { label: e.label, text }] }),
        e
      );
      addToast("Follow-up logged", "default");
    },
    [patchJob, addToast]
  );

  const abandonJob = useCallback(
    (jobId, reason) => {
      patchJob(
        jobId,
        (j) => ({
          ...j,
          status: "closed",
          closedAt: TODAY,
          abandoned: true,
          abandonReason: reason,
        }),
        nowEntry(`Job abandoned — ${reason}`, "status")
      );
      addToast("Job marked abandoned", "danger");
    },
    [patchJob, addToast]
  );

  const haulToShop = useCallback(
    (jobId) => {
      patchJob(
        jobId,
        (j) => ({ ...j, jobType: "carry-in" }),
        nowEntry("Converted home visit to carry-in (hauled to shop)", "status")
      );
      addToast("Converted to carry-in", "default");
    },
    [patchJob, addToast]
  );

  const reschedule = useCallback(
    (jobId, { preferredDate, timeWindow }) => {
      patchJob(
        jobId,
        (j) => ({ ...j, preferredDate, timeWindow }),
        nowEntry("Home visit rescheduled", "status")
      );
      addToast("Visit rescheduled", "default");
    },
    [patchJob, addToast]
  );

  const clockIn = useCallback((techId) => {
    const t = fmtTime(new Date());
    setAttendanceToday((prev) => ({
      ...prev,
      [techId]: {
        ...prev[techId],
        status: prev[techId]?.status === "field" ? "field" : "present",
        clockedIn: true,
        clockIn: t,
        clockOut: null,
      },
    }));
  }, []);

  const clockOut = useCallback((techId) => {
    const t = fmtTime(new Date());
    setAttendanceToday((prev) => ({
      ...prev,
      [techId]: { ...prev[techId], clockedIn: false, clockOut: t },
    }));
  }, []);

  // Resolve by UUID id or by human token, so links built from either (e.g. the
  // schedule's token references) keep working.
  const getJob = useCallback(
    (idOrToken) => jobs.find((j) => j.id === idOrToken || String(j.token) === String(idOrToken)),
    [jobs]
  );
  const jobsByStatus = useCallback((status) => jobs.filter((j) => j.status === status), [jobs]);
  const jobsForTech = useCallback(
    (techId, includeClosed = false) =>
      jobs.filter((j) => j.assignedTechId === techId && (includeClosed || j.status !== "closed")),
    [jobs]
  );

  const globalActivity = useMemo(() => {
    const all = [];
    jobs.forEach((j) => {
      (j.timeline || []).forEach((e) => all.push({ ...e, jobId: j.id, jobToken: j.token }));
    });
    return all.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  }, [jobs]);

  const value = {
    jobs,
    technicians,
    attendanceToday,
    currentTechId,
    setCurrentTechId,
    toasts,
    addToast,
    removeToast,
    // mutators
    addJob,
    addNote,
    setEstimate,
    addEstimateLineItem,
    setEstimateStatus,
    markReady,
    logPayment,
    closeJob,
    followUp,
    abandonJob,
    haulToShop,
    reschedule,
    clockIn,
    clockOut,
    // selectors
    getJob,
    jobsByStatus,
    jobsForTech,
    globalActivity,
    RATE,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
