/**
 * State for the clock-in/out screen. The technician identity comes from the
 * logged-in session (NOT a free-text field) so a punch is always attributed to
 * whoever signed in.
 *
 * Offline-first, but server-reconciled: the local queue is the instant-success
 * write + the "pending sync" signal, while the authoritative clocked-in status
 * and punch history come from the backend (so the log survives a reinstall and
 * reflects punches made on other devices). The two are merged — local pending
 * punches show optimistically until they sync, then the server copy takes over.
 */

import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Vibration } from "react-native";

import { attendanceApi, type PunchItem, type Shift } from "../../lib/attendanceApi";
import { useAuth } from "../auth/AuthContext";
import { clearAttendancePrompt } from "./attendancePrompt";
import { loadQueue, type QueuedPunch } from "./queue";
import { punch } from "./punch";
import { syncNow } from "./sync";

// Retry-while-pending backoff: 3s → 60s. The effect re-runs (resetting to base)
// whenever pendingCount changes, so a stuck punch backs off instead of polling
// every 3s forever.
const SYNC_BASE_MS = 3_000;
const SYNC_MAX_MS = 60_000;
const HISTORY_DAYS = 7;

export interface PunchRow {
  key: string;
  kind: "clock_in" | "clock_out";
  at: string; // ISO timestamp
  isMock: boolean;
  hasWifi: boolean;
  synced: boolean;
  selfieFailed: boolean;
}

export function useAttendance() {
  const { technician } = useAuth();
  const techId = technician?.id ?? null;

  const [all, setAll] = useState<QueuedPunch[]>([]);
  const [serverPunches, setServerPunches] = useState<PunchItem[]>([]);
  const [serverClockedIn, setServerClockedIn] = useState<boolean | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setAll(await loadQueue());
    if (!techId) return;
    // Authoritative status + recent history (best-effort; offline keeps stale).
    try {
      const end = new Date();
      const start = new Date(end.getTime() - HISTORY_DAYS * 24 * 3600 * 1000);
      const [today, list, shiftData] = await Promise.all([
        attendanceApi.today(techId),
        attendanceApi.listPunches(techId, start.toISOString(), end.toISOString()),
        attendanceApi.getShift(techId).catch(() => null),
      ]);
      setServerClockedIn(today.clocked_in);
      setServerPunches(list);
      setShift(shiftData);
    } catch {
      // Keep the last-known server state; the local queue still drives the UI.
    }
  }, [techId]);

  // Sync (the signed-in tech's punches only), then re-read queue + server.
  const syncAndRefresh = useCallback(async () => {
    await syncNow(techId);
    await refresh();
  }, [techId, refresh]);

  // Sync on mount, reconnect, and app-foreground.
  useEffect(() => {
    void refresh();
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void syncAndRefresh();
    });
    const app = AppState.addEventListener("change", (st) => {
      if (st === "active") void syncAndRefresh();
    });
    return () => {
      net();
      app.remove();
    };
  }, [refresh, syncAndRefresh]);

  // Pending = MY unsynced punches. Another tech's queued punch on this shared
  // phone is their session's business — counting it here would show a
  // "pending sync" this login can never clear.
  const pendingCount = useMemo(
    () => all.filter((p) => p.tech_id === techId && !p.done).length,
    [all, techId],
  );

  // My local punches that haven't reached the server yet (shown optimistically).
  const localPending = useMemo(() => {
    const serverIds = new Set(serverPunches.map((p) => p.client_id));
    return all.filter((p) => p.tech_id === techId && !p.done && !serverIds.has(p.client_id));
  }, [all, techId, serverPunches]);

  // Merge optimistic local-pending + authoritative server history, newest first.
  const punches = useMemo<PunchRow[]>(() => {
    const local: PunchRow[] = localPending.map((p) => ({
      key: p.client_id,
      kind: p.kind,
      at: p.created_at,
      isMock: p.is_mock_location,
      hasWifi: Boolean(p.wifi_bssid),
      synced: false,
      selfieFailed: false,
    }));
    const server: PunchRow[] = serverPunches.map((p) => ({
      key: p.id,
      kind: p.kind,
      at: p.created_at,
      isMock: p.is_mock_location,
      hasWifi: Boolean(p.wifi_bssid),
      synced: true,
      selfieFailed: p.selfie_status === "pending" && (Date.now() - new Date(p.created_at).getTime() > 24 * 3600 * 1000),
    }));
    return [...local, ...server].sort((a, b) => b.at.localeCompare(a.at));
  }, [localPending, serverPunches]);

  // Clocked-in: a just-made local punch wins (optimistic), else the server truth.
  const clockedIn = useMemo(() => {
    if (localPending.length > 0) {
      const latest = [...localPending].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return latest?.kind === "clock_in";
    }
    return serverClockedIn ?? false;
  }, [localPending, serverClockedIn]);

  // Keep retrying while anything is unsynced, with exponential backoff.
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
        void syncAndRefresh();
        delayRef.current = Math.min(delayRef.current * 2, SYNC_MAX_MS);
        tick();
      }, delayRef.current);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pendingCount, syncAndRefresh]);

  const doPunch = useCallback(
    async (kind: QueuedPunch["kind"]) => {
      if (!techId) {
        setError("You are not signed in.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await punch({ techId, kind });
        // A short buzz confirms success without the tech needing to read the
        // screen — important for low-literacy users. Clear any prompt that
        // brought them here so the primed banner resolves.
        Vibration.vibrate(40);
        clearAttendancePrompt();
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
    technicianName: technician?.name ?? "",
    clockedIn,
    pendingCount,
    punches,
    busy,
    error,
    clockIn: () => doPunch("clock_in"),
    clockOut: () => doPunch("clock_out"),
    refresh,
    shift,
  };
}
