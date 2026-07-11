/**
 * Mounted once in the authed shell. Drains the pending-media queue (voice
 * notes waiting for their offline-created job to exist) on the same triggers
 * the outbox uses: mount, reconnect, foreground, and every outbox change —
 * the change that matters is a queued create finally syncing.
 */

import NetInfo from "@react-native-community/netinfo";
import { useEffect } from "react";
import { AppState } from "react-native";

import { onOutboxChange } from "../../lib/outbox";
import { drainPendingMedia } from "./pendingMedia";

export function usePendingMediaDrain(): void {
  useEffect(() => {
    void drainPendingMedia();
    const unsubNet = NetInfo.addEventListener((s) => {
      if (s.isConnected) void drainPendingMedia();
    });
    const appState = AppState.addEventListener("change", (st) => {
      if (st === "active") void drainPendingMedia();
    });
    const unsubOutbox = onOutboxChange(() => void drainPendingMedia());
    return () => {
      unsubNet();
      appState.remove();
      unsubOutbox();
    };
  }, []);
}
