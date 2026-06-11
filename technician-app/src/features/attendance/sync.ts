/**
 * Background sync: drains the offline queue to the backend. Safe to call often
 * and concurrently (guarded by an in-flight flag). Each pending punch:
 *   1. POST /punches — idempotent on client_id, so re-sends are no-ops and a
 *      still-pending selfie gets a fresh signed upload URL.
 *   2. PUT the selfie bytes to R2 (decoupled — the punch is already valid),
 *      then POST /selfie/complete.
 *   3. Mark done once recorded and the selfie has settled (uploaded, rejected,
 *      or absent).
 * A failure on any item leaves it queued for the next pass.
 *
 * Only the signed-in technician's punches are flushed: the backend attributes
 * punches to the JWT and 403s anyone else's, so on a shared phone another
 * tech's queued punch must WAIT for its owner to sign back in — not burn
 * retries (and confuse the pending counter) under the wrong session. Mirrors
 * the jobs outbox's per-tech skip.
 */

import * as FileSystem from "expo-file-system";

import { attendanceApi } from "../../lib/attendanceApi";
import { loadQueue, pendingPunches, removePunches, updatePunch, type QueuedPunch } from "./queue";

let syncing = false;

export async function syncNow(techId: string | null): Promise<void> {
  if (syncing || !techId) return;
  syncing = true;
  try {
    for (const item of await pendingPunches()) {
      if (item.tech_id !== techId) continue; // another tech's — wait for their session
      try {
        await syncOne(item);
      } catch {
        // Leave it queued; the next trigger retries.
      }
    }
    await pruneSettled();
  } finally {
    syncing = false;
  }
}

/**
 * Drop fully-settled (done) punches and delete their local selfie files.
 * Without this the queue and the `documentDirectory/attendance` folder grow
 * forever (~2 punches + selfies a day, per phone, for the life of the
 * install). Done = the server has the punch AND the selfie has settled, so
 * nothing here is evidence — the UI renders settled punches from the server
 * log, never from these entries. Any tech's settled items qualify (cleanup
 * is owner-agnostic; only UNSYNCED punches wait for their owner's session).
 * Exported for tests.
 */
export async function pruneSettled(): Promise<void> {
  const settled = (await loadQueue()).filter((i) => i.done);
  const removable: string[] = [];
  for (const item of settled) {
    try {
      if (item.selfie_uri) {
        await FileSystem.deleteAsync(item.selfie_uri, { idempotent: true });
      }
      removable.push(item.client_id);
    } catch {
      // File delete failed — keep the entry so the next sweep retries it.
    }
  }
  await removePunches(removable);
}

async function syncOne(item: QueuedPunch): Promise<void> {
  // 1. Record (idempotent). Re-touching a pending punch re-mints the selfie URL.
  const resp = await attendanceApi.recordPunch({
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
    selfie_filename: item.selfie_uri ? item.selfie_filename : null,
    selfie_content_type: item.selfie_uri ? item.selfie_content_type : null,
  });

  if (!item.server_event_id) {
    await updatePunch(item.client_id, { server_event_id: resp.event_id });
  }

  // 2. Selfie upload (best-effort, decoupled from the punch). The punch is
  // recorded at this point, so a null `resp.selfie` means the server considers
  // the selfie settled (uploaded — or rejected, e.g. oversized): nothing left
  // to send. Without that, a rejected selfie would re-queue forever.
  let selfieDone = !item.selfie_uri || item.selfie_done || !resp.selfie;
  if (!selfieDone && item.selfie_uri && resp.selfie) {
    const put = await FileSystem.uploadAsync(resp.selfie.signed_url, item.selfie_uri, {
      httpMethod: "PUT",
      headers: { "Content-Type": item.selfie_content_type ?? "image/jpeg" },
    });
    if (put.status < 400) {
      const info = await FileSystem.getInfoAsync(item.selfie_uri, { size: true });
      const size = info.exists && "size" in info ? info.size : undefined;
      await attendanceApi.completeSelfie(resp.event_id, item.tech_id, { size_bytes: size });
      await updatePunch(item.client_id, { selfie_done: true });
      selfieDone = true;
    }
  }

  // 3. Settled.
  if (selfieDone) {
    await updatePunch(item.client_id, { done: true });
  }
}
