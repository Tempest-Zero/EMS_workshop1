/**
 * Drains the offline presence queue (geofence crossings) to the backend. Safe
 * to call often and concurrently (guarded by an in-flight flag). Mirrors the
 * punch sync, minus the selfie leg: a crossing is a single idempotent POST.
 *
 * Runs from TWO contexts: the foreground app (alongside the punch sync) and the
 * headless background geofence task. In the headless case the in-memory bearer
 * cache is cold (fresh JS context), so we hydrate it from storage first —
 * otherwise the POST would go out unauthenticated and 401. Only the signed-in
 * tech's crossings are flushed; another tech's wait for their own session, the
 * same shared-device rule the punch sync follows.
 */

import { getToken, loadToken } from "../../lib/auth";
import { attendanceApi } from "../../lib/attendanceApi";
import { markPresenceDone, pendingPresence, removePresence } from "./presenceQueue";

let syncing = false;

export async function syncPresence(techId: string | null): Promise<void> {
  if (syncing || !techId) return;
  syncing = true;
  try {
    // Headless launches start with an empty token cache — rehydrate the
    // persisted bearer so `attendanceApi` (which reads it synchronously) sends
    // it. A no-op in the foreground app, where AuthContext already loaded it.
    if (!getToken()) await loadToken();

    const settled: string[] = [];
    for (const item of await pendingPresence()) {
      if (item.tech_id !== techId) continue; // another tech's — wait for their session
      try {
        await attendanceApi.recordPresence({
          client_id: item.client_id,
          tech_id: item.tech_id,
          kind: item.kind,
          shop_id: item.shop_id,
          device_time: item.device_time,
          lat: item.lat,
          lng: item.lng,
          accuracy_m: item.accuracy_m,
          is_mock_location: item.is_mock_location,
          wifi_bssid: item.wifi_bssid,
          wifi_ssid: item.wifi_ssid,
        });
        await markPresenceDone(item.client_id);
        settled.push(item.client_id);
      } catch {
        // Leave it queued; the next trigger retries. Never dropped.
      }
    }
    await removePresence(settled);
  } finally {
    syncing = false;
  }
}
