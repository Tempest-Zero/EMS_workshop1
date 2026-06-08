/**
 * State for the clock-in/out screen. Source of truth is the local queue
 * (offline-first): "clocked in?" and "pending sync" are derived from it, so the
 * screen works with no network. Sync is triggered on mount, on reconnect, on
 * app-foreground, and on a short interval while anything is still pending.
 */

import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { loadQueue, type QueuedPunch } from "./queue";
import { punch } from "./punch";
import { syncNow } from "./sync";

const DEFAULT_TECH = "t1";

// Retry-while-pending backoff: start at 3s, double up to 60s. The effect re-runs
// (resetting to base) whenever pendingCount changes — i.e. on progress or a new
// punch — so a permanently-failing item backs off instead of hammering at 3s.
const SYNC_BASE_MS = 3_000;
const SYNC_MAX_MS = 60_000;

export function useAttendance() {
  const [techId, setTechId] = useState(DEFAULT_TECH);
  const [all, setAll] = useState<QueuedPunch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAll(await loadQueue());
  }, []);

  // Sync on mount, reconnect, and app-foreground.
  useEffect(() => {
    void refresh();
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void syncNow().then(refresh);
    });
    const app = AppState.addEventListener("change", (st) => {
      if (st === "active") void syncNow().then(refresh);
    });
    return () => {
      net();
      app.remove();
    };
  }, [refresh]);

  const punches = useMemo(
    () =>
      all
        .filter((p) => p.tech_id === techId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [all, techId],
  );
  const pendingCount = useMemo(() => all.filter((p) => !p.done).length, [all]);
  const clockedIn = punches[0]?.kind === "clock_in";

  // Keep retrying while anything is unsynced, with exponential backoff so a
  // stuck punch doesn't poll the network every 3s forever. Re-running on a
  // pendingCount change (progress / new punch) resets the delay to base.
  const delayRef = useRef(SYNC_BASE_MS);
  useEffect(() => {
    if (pendingCount === 0) {
      delayRef.current = SYNC_BASE_MS;
      return undefined;
    }
    delayRef.current = SYNC_BASE_MS;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout>;
    const tick = () => {
      handle = setTimeout(() => {
        if (cancelled) return;
        void syncNow().then(refresh);
        delayRef.current = Math.min(delayRef.current * 2, SYNC_MAX_MS);
        tick();
      }, delayRef.current);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pendingCount, refresh]);

  const doPunch = useCallback(
    async (kind: QueuedPunch["kind"]) => {
      setBusy(true);
      setError(null);
      try {
        await punch({ techId, kind });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [techId, refresh],
  );

  return {
    techId,
    setTechId,
    clockedIn,
    pendingCount,
    punches,
    busy,
    error,
    clockIn: () => doPunch("clock_in"),
    clockOut: () => doPunch("clock_out"),
    refresh,
  };
}
