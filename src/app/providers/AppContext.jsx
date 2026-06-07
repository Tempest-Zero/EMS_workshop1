import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import { useAuth } from "@app/providers/AuthContext";
import {
  fetchJobs,
  fetchJob,
  createJob,
  addJobNote,
  addJobFollowup,
  transitionJob,
} from "@features/jobs/data/jobsApi";
import { mapApiJob, toCreateBody } from "@features/jobs/data/mapJob";
import { technicians } from "@features/technicians/data/technicians";
import { todayRecord } from "@features/attendance/data/attendance";
import { nowEntry, fmtTime } from "@shared/lib/date";
import { estimateTotal, billOriginal } from "@shared/lib/job";

const RATE = 1200;

// Fields the API doesn't own yet (J4) — preserved across server refreshes so a
// locally-set estimate/bill/revenue isn't wiped when a lifecycle action returns
// the authoritative job.
const LOCAL_ONLY_FIELDS = ["estimate", "payment", "bill", "revenue", "photos", "followUps"];

const newId = () => Math.random().toString(36).slice(2, 10);

const AppContext = createContext(null);

/** Overlay a server-authoritative job onto the list, keeping local-only fields. */
function applyServerJob(prevJobs, mapped) {
  const idx = prevJobs.findIndex((j) => j.id === mapped.id);
  if (idx === -1) return [mapped, ...prevJobs];
  const server = { ...mapped };
  LOCAL_ONLY_FIELDS.forEach((k) => delete server[k]);
  const next = [...prevJobs];
  next[idx] = { ...next[idx], ...server };
  return next;
}

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

  // A live mirror of `jobs` so the detail loader can resolve a token → id
  // without taking `jobs` as a dependency (which would re-fire the detail fetch
  // on every job mutation).
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  // Replace a job from a full detail response (job + timeline), keeping any
  // local-only estimate/payment. Returns the mapped job.
  const replaceFromDetail = useCallback((detail) => {
    const mapped = mapApiJob(detail);
    setJobs((prev) => applyServerJob(prev, mapped));
    return mapped;
  }, []);

  // Fetch a single job's detail (the only response that carries the timeline)
  // and merge it in. Accepts a uuid or a human token.
  const loadJobDetail = useCallback(
    async (idOrToken) => {
      const known = jobsRef.current.find(
        (j) => j.id === idOrToken || String(j.token) === String(idOrToken)
      );
      const detail = await fetchJob(known?.id || idOrToken);
      return replaceFromDetail(detail);
    },
    [replaceFromDetail]
  );

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
    async (jobId, text) => {
      try {
        const detail = await addJobNote(jobId, text);
        replaceFromDetail(detail);
      } catch {
        addToast("Couldn't save note — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
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
    async (jobId) => {
      try {
        const detail = await transitionJob(jobId, { action: "ready" });
        replaceFromDetail(detail);
        addToast("Job marked ready for pickup", "ready");
      } catch {
        addToast("Couldn't mark ready — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  // ── Billing & revenue (Module 4) ─────────────────────────────────────
  // Record the negotiated amount agreed on-site. Both the auto-generated
  // original and the negotiated figure are kept (hard accounting requirement).
  const setNegotiatedBill = useCallback(
    (jobId, { amount, note }) => {
      const value = Number(amount);
      patchJob(
        jobId,
        (j) => ({
          ...j,
          bill: {
            ...(j.bill || {}),
            original: billOriginal(j),
            negotiated: value,
            status: "negotiated",
          },
        }),
        nowEntry(
          `Bill negotiated → agreed Rs ${value.toLocaleString("en-PK")}${note ? ` (${note})` : ""}`,
          "payment"
        )
      );
      addToast("Negotiated amount recorded", "ready");
    },
    [patchJob, addToast]
  );

  // Append a cash/revenue entry. The ledger is append-only — corrections void
  // an entry rather than editing it (see voidRevenueEntry).
  const logPayment = useCallback(
    (jobId, { amount, method }) => {
      const e = nowEntry(
        `Payment logged: Rs ${Number(amount).toLocaleString("en-PK")} (${method})`,
        "payment"
      );
      const entry = {
        id: newId(),
        amount: Number(amount),
        method,
        ts: e.ts,
        label: e.label,
        voided: false,
      };
      patchJob(jobId, (j) => ({ ...j, revenue: [...(j.revenue || []), entry] }), e);
      addToast("Payment recorded", "ready");
    },
    [patchJob, addToast]
  );

  // Correct a revenue entry: mark it voided (kept for the audit trail) with a
  // reason. Re-logging the right amount is a normal logPayment afterward.
  const voidRevenueEntry = useCallback(
    (jobId, entryId, reason) => {
      patchJob(
        jobId,
        (j) => ({
          ...j,
          revenue: (j.revenue || []).map((e) =>
            e.id === entryId ? { ...e, voided: true, voidReason: reason } : e
          ),
        }),
        nowEntry(`Revenue entry voided — ${reason}`, "payment")
      );
      addToast("Entry voided for correction", "default");
    },
    [patchJob, addToast]
  );

  const closeJob = useCallback(
    async (jobId) => {
      try {
        const detail = await transitionJob(jobId, { action: "close" });
        replaceFromDetail(detail);
        addToast("Job closed and moved to history", "default");
      } catch {
        addToast("Couldn't close job — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  const followUp = useCallback(
    async (jobId, text) => {
      try {
        const detail = await addJobFollowup(jobId, text);
        replaceFromDetail(detail);
        addToast("Follow-up logged", "default");
      } catch {
        addToast("Couldn't log follow-up — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  const abandonJob = useCallback(
    async (jobId, reason) => {
      try {
        const detail = await transitionJob(jobId, { action: "abandon", reason });
        replaceFromDetail(detail);
        addToast("Job marked abandoned", "danger");
      } catch {
        addToast("Couldn't abandon job — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  const haulToShop = useCallback(
    async (jobId) => {
      try {
        const detail = await transitionJob(jobId, { action: "haul" });
        replaceFromDetail(detail);
        addToast("Converted to carry-in", "default");
      } catch {
        addToast("Couldn't convert job — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  const reschedule = useCallback(
    async (jobId, { preferredDate, timeWindow }) => {
      try {
        const detail = await transitionJob(jobId, {
          action: "reschedule",
          preferred_date: preferredDate || null,
          time_window: timeWindow || null,
        });
        replaceFromDetail(detail);
        addToast("Visit rescheduled", "default");
      } catch {
        addToast("Couldn't reschedule — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
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
    loadJobDetail,
    addNote,
    setEstimate,
    addEstimateLineItem,
    setEstimateStatus,
    markReady,
    setNegotiatedBill,
    logPayment,
    voidRevenueEntry,
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
