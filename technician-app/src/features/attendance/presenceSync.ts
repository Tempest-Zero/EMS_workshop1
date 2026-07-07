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
 *
 * Failure classification mirrors the punch sync / jobs outbox: 401 stops the
 * drain (keep queued), a definitive 4xx parks the crossing in the visible "did
 * not sync" list, a 5xx/429 counts toward MAX_ATTEMPTS then parks, and a
 * network error stops the drain to retry next trigger.
 */

import { ApiError } from "../../lib/api";
import {
  failureReason,
  isAuthFailure,
  isDefinitiveRejection,
  MAX_ATTEMPTS,
} from "../../lib/syncClassification";
import { getToken, loadToken } from "../../lib/auth";
import { attendanceApi } from "../../lib/attendanceApi";
import {
  bumpPresenceAttempts,
  markPresenceDone,
  markPresenceFailed,
  pendingPresence,
  removePresence,
} from "./presenceQueue";

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
          confirmed: item.confirmed,
        });
        await markPresenceDone(item.client_id);
        settled.push(item.client_id);
      } catch (e) {
        if (isAuthFailure(e)) break; // token dead; queue survives logout → re-login
        // A single idempotent POST (no compound selfie leg), so a definitive
        // rejection parks the crossing straight away — it will never succeed.
        if (isDefinitiveRejection(e)) {
          await markPresenceFailed(item.client_id, failureReason(e));
          continue; // a parked item must not block the ones behind it
        }
        if (e instanceof ApiError) {
          const attempts = await bumpPresenceAttempts(item.client_id);
          if (attempts >= MAX_ATTEMPTS) {
            await markPresenceFailed(
              item.client_id,
              `gave up after ${attempts} attempts (server ${e.status})`,
            );
            continue;
          }
          break; // transient — retry the whole queue next trigger
        }
        break; // pure connectivity failure — never counts; stop and retry later
      }
    }
    await removePresence(settled);
  } finally {
    syncing = false;
  }
}
