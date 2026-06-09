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
  assignJob as assignJobApi,
  submitCompletion as submitCompletionApi,
  negotiateBill as negotiateBillApi,
  logPayment as logPaymentApi,
  voidPayment as voidPaymentApi,
} from "@features/jobs/data/jobsApi";
import { mapApiJob, toCreateBody } from "@features/jobs/data/mapJob";
import { technicians as seedTechnicians } from "@features/technicians/data/technicians";
import { fetchTechnicians } from "@features/auth/data/authApi";
import { fetchBoard } from "@features/attendance/data/attendanceApi";
import { nowEntry, fmtTime } from "@shared/lib/date";
import { estimateTotal } from "@shared/lib/job";
import { rupeesToPaisa } from "@shared/lib/currency";

const RATE = 1200;

// Fields the API doesn't own yet — preserved across server refreshes so a
// locally-set estimate/assignment isn't wiped when a lifecycle action returns
// the authoritative job. Bill / revenue / completion are now API-backed (P2f),
// so they're intentionally NOT here — the server is the single source of truth.
const LOCAL_ONLY_FIELDS = ["estimate", "payment", "photos", "followUps"];

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

// Map the live attendance board (server-authoritative for *today*, incl. mobile
// punches) into the { [techId]: { status, clockIn, clockOut, clockedIn } } shape
// the manager screens read.
function boardToAttendance(rows) {
  const map = {};
  (rows || []).forEach((r) => {
    const onDuty = ["present", "field", "half"].includes(r.status);
    map[r.tech_id] = {
      status: r.status,
      clockIn: r.first_in ? fmtTime(new Date(r.first_in)) : null,
      clockOut: r.last_out ? fmtTime(new Date(r.last_out)) : null,
      clockedIn: onDuty && !r.last_out,
    };
  });
  return map;
}

export function AppProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [jobs, setJobs] = useState([]);
  // Seed the roster for an instant first paint / offline fallback; the live
  // roster (and today's attendance) replace it once authenticated.
  const [technicians, setTechnicians] = useState(seedTechnicians);
  const [currentTechId, setCurrentTechId] = useState("t1");
  const [attendanceToday, setAttendanceToday] = useState({});
  const [toasts, setToasts] = useState([]);

  // Stable accessor for the live roster — lets toast callbacks (assign/claim)
  // resolve a tech name without re-creating on every roster change.
  const techniciansRef = useRef(technicians);
  useEffect(() => {
    techniciansRef.current = technicians;
  }, [technicians]);
  const techName = useCallback(
    (id) => techniciansRef.current.find((t) => t.id === id)?.name || id,
    []
  );

  // Load the live roster + today's attendance board once authenticated, so the
  // manager Dashboard / Technicians views reflect real data (including mobile
  // clock-ins) instead of seed data. On failure the seeded roster stays.
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    let cancelled = false;
    fetchTechnicians()
      .then((rows) => {
        if (!cancelled && Array.isArray(rows) && rows.length) setTechnicians(rows);
      })
      .catch(() => {});
    fetchBoard(seedTechnicians.map((t) => t.id))
      .then((board) => {
        if (!cancelled) setAttendanceToday(boardToAttendance(board?.rows));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

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

  // ── Dual assignment (Module 2): manager assigns OR technician free-picks ──
  // Both call the real /assign endpoint and merge the authoritative job back, so
  // the assignment persists server-side (and the mobile app sees it).
  const assignJob = useCallback(
    async (jobId, techId) => {
      try {
        const detail = await assignJobApi(jobId, techId);
        replaceFromDetail(detail);
        addToast(`Assigned to ${techName(techId)}`, "default");
      } catch {
        addToast("Couldn't assign — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast, techName]
  );

  const claimJob = useCallback(
    async (jobId, techId) => {
      try {
        const detail = await assignJobApi(jobId, techId);
        replaceFromDetail(detail);
        addToast(`Claimed by ${techName(techId)}`, "ready");
      } catch {
        addToast("Couldn't claim — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast, techName]
  );

  // ── Work completion (Module 3) → auto-generates the bill (Module 4) ──
  // Rupees from the form → integer paisa at the API boundary. The server returns
  // the authoritative job (with the regenerated bill + timeline), merged in via
  // replaceFromDetail — no local bill math.
  const submitCompletion = useCallback(
    async (jobId, payload) => {
      try {
        const detail = await submitCompletionApi(jobId, {
          materials: (payload.materials || []).map((m) => ({
            name: m.name,
            qty: Number(m.qty) || 1,
            unit_paisa: rupeesToPaisa(m.unitPrice),
          })),
          time_spent_mins: Number(payload.timeSpentMins) || 0,
          fuel_paisa: rupeesToPaisa(payload.fuelAmount),
          remarks_text: payload.remarksText?.trim() || null,
        });
        replaceFromDetail(detail);
        addToast("Completion submitted — bill generated", "ready");
      } catch {
        addToast("Couldn't submit completion — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  // ── Billing & revenue (Module 4) ─────────────────────────────────────
  // Record the negotiated amount agreed on-site (rupees → paisa). The backend
  // keeps both the auto original and the negotiated figure.
  const setNegotiatedBill = useCallback(
    async (jobId, { amount, note }) => {
      try {
        const detail = await negotiateBillApi(jobId, rupeesToPaisa(amount), note);
        replaceFromDetail(detail);
        addToast("Negotiated amount recorded", "ready");
      } catch {
        addToast("Couldn't record negotiation — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  // Append a cash/revenue entry. A fresh `client_id` (UUID) makes it idempotent
  // so a retry never double-charges. The ledger is append-only — corrections
  // void an entry rather than editing it (see voidRevenueEntry).
  const logPayment = useCallback(
    async (jobId, { amount, method }) => {
      try {
        const detail = await logPaymentApi(
          jobId,
          rupeesToPaisa(amount),
          method,
          crypto.randomUUID()
        );
        replaceFromDetail(detail);
        addToast("Payment recorded", "ready");
      } catch {
        addToast("Couldn't record payment — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
  );

  // Correct a revenue entry: the server voids it (kept struck-through for the
  // audit trail) with a reason. Re-logging the right amount is a normal
  // logPayment afterward.
  const voidRevenueEntry = useCallback(
    async (jobId, entryId, reason) => {
      try {
        const detail = await voidPaymentApi(jobId, entryId, reason);
        replaceFromDetail(detail);
        addToast("Entry voided for correction", "default");
      } catch {
        addToast("Couldn't void entry — please retry", "danger");
      }
    },
    [replaceFromDetail, addToast]
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
    assignJob,
    claimJob,
    submitCompletion,
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
