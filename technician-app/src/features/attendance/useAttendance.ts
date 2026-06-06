/**
 * State for the clock-in/out screen. Source of truth is the local queue
 * (offline-first): "clocked in?" and "pending sync" are derived from it, so the
 * screen works with no network. Sync is triggered on mount, on reconnect, on
 * app-foreground, and on a short interval while anything is still pending.
 */

import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { loadQueue, type QueuedPunch } from "./queue";
import { punch } from "./punch";
import { syncNow } from "./sync";

const DEFAULT_TECH = "t1";

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

  // Keep retrying + refreshing while anything is unsynced (self-clears at 0).
  useEffect(() => {
    if (pendingCount === 0) return undefined;
    const id = setInterval(() => void syncNow().then(refresh), 3000);
    return () => clearInterval(id);
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
