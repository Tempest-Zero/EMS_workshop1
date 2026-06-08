/**
 * Drives the job outbox app-wide: flush on mount, on reconnect, on
 * app-foreground, and on a backoff retry while anything is pending. Mounted once
 * (in the authenticated shell) so queued writes sync even after the technician
 * leaves the screen that made them. Returns the pending count for an indicator.
 */

import NetInfo from "@react-native-community/netinfo";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import { onOutboxChange, outboxCount } from "./outbox";
import { flushOutbox } from "./outboxSync";

const BASE_MS = 4_000;
const MAX_MS = 60_000;

export function useOutboxSync(): number {
  const [pending, setPending] = useState(0);
  const refresh = useCallback(async () => {
    setPending(await outboxCount());
  }, []);

  useEffect(() => {
    void refresh();
    void flushOutbox().then(refresh);
    const off = onOutboxChange(refresh);
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void flushOutbox().then(refresh);
    });
    const app = AppState.addEventListener("change", (st) => {
      if (st === "active") void flushOutbox().then(refresh);
    });
    return () => {
      off();
      net();
      app.remove();
    };
  }, [refresh]);

  // Backoff retry while pending (self-clears at 0).
  const delayRef = useRef(BASE_MS);
  useEffect(() => {
    if (pending === 0) {
      delayRef.current = BASE_MS;
      return undefined;
    }
    delayRef.current = BASE_MS;
    let cancelled = false;
    let handle: ReturnType<typeof setTimeout>;
    const tick = () => {
      handle = setTimeout(() => {
        if (cancelled) return;
        void flushOutbox().then(refresh);
        delayRef.current = Math.min(delayRef.current * 2, MAX_MS);
        tick();
      }, delayRef.current);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [pending, refresh]);

  return pending;
}
