/**
 * Drains the offline on-duty ping queue to the backend in batches. Safe to call
 * often and concurrently (guarded by an in-flight flag). Mirrors the presence
 * sync, but batched: the server accepts up to 100 pings per POST and dedups on
 * client_id, so a re-sent (overlapping) batch is a safe no-op.
 *
 * Runs from the foreground app AND the headless location task, so it hydrates
 * the bearer cache from storage first (cold JS context would otherwise 401).
 * Only the signed-in tech's pings are flushed — another tech's wait for their
 * own session (the shared-device rule the punch/presence syncs follow).
 */

import { getToken, loadToken } from "../../lib/auth";
import { attendanceApi } from "../../lib/attendanceApi";
import { markPingsDone, pendingPings, removePings } from "./pingQueue";

const MAX_BATCH = 100; // the server's per-request cap

let syncing = false;

export async function syncPings(techId: string | null): Promise<void> {
  if (syncing || !techId) return;
  syncing = true;
  try {
    if (!getToken()) await loadToken();

    const mine = (await pendingPings()).filter((p) => p.tech_id === techId);
    const settled: string[] = [];
    for (let i = 0; i < mine.length; i += MAX_BATCH) {
      const batch = mine.slice(i, i + MAX_BATCH);
      try {
        await attendanceApi.recordPings(
          batch.map((p) => ({
            client_id: p.client_id,
            tech_id: p.tech_id,
            shop_id: p.shop_id,
            captured_at: p.captured_at,
            lat: p.lat,
            lng: p.lng,
            accuracy_m: p.accuracy_m,
            is_mock_location: p.is_mock_location,
            wifi_bssid: p.wifi_bssid,
            wifi_ssid: p.wifi_ssid,
          })),
        );
        const ids = batch.map((p) => p.client_id);
        await markPingsDone(ids);
        settled.push(...ids);
      } catch {
        // This batch failed (offline / 5xx): stop draining and leave it — and
        // every later batch — queued for the next trigger. Never dropped here.
        break;
      }
    }
    await removePings(settled);
  } finally {
    syncing = false;
  }
}
