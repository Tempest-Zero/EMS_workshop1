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
 *
 * Failure classification differs from the punch/presence syncs in ONE way:
 * pings are droppable by design (`pingQueue.ts`), so a definitive 4xx batch is
 * DROPPED (marked done — no visible failed list, no user action) rather than
 * parked. Coverage degrades to an honest no_data gap, which the variance report
 * already renders neutrally. A 401 still stops the drain — an expired token
 * must never be mistaken for a bad payload and eat the pings.
 */

import { isDefinitiveRejection } from "../../lib/syncClassification";
import { getToken, loadToken } from "../../lib/auth";
// (No ApiError import needed: the batch either drops on a definitive rejection
// or breaks the drain on everything else — no per-status branching here.)
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
      } catch (e) {
        // 401 is a dead token, never a "definitive rejection" (isAuthFailure is
        // separate from DEFINITIVE_4XX), so it can't drop pings — it falls
        // through to the break below and the batch waits for a fresh session.
        if (isDefinitiveRejection(e)) {
          // The server rejected this batch outright (e.g. every captured_at
          // outside the trust window, or a 422). Retrying can never make it
          // succeed, so DROP it — pings are droppable and the gap reads as
          // honest no_data. Continue to the next batch (later pings may be fine).
          const ids = batch.map((p) => p.client_id);
          await markPingsDone(ids);
          settled.push(...ids);
          continue;
        }
        // Offline / 5xx / 429 / 401: stop draining and leave this — and every
        // later batch — queued for the next trigger. Never dropped here.
        break;
      }
    }
    await removePings(settled);
  } finally {
    syncing = false;
  }
}
