/**
 * Drains the travel-breadcrumb queue to `POST /api/jobs/{id}/travel-samples`
 * in per-job batches (server cap 100/request, dedups on client_id — an
 * overlapping re-send is a safe no-op).
 *
 * Failure classification mirrors the PING sync, not the punch sync:
 * breadcrumbs are droppable telemetry (see travelQueue.ts), so a definitive
 * 4xx batch is DROPPED — e.g. a 403 because the job was reassigned, or every
 * captured_at outside the trust window. The fuel line falls back to the
 * estimate; nothing is fabricated. A 401 still stops the drain (dead token ≠
 * bad payload). Runs from the foreground app AND the headless travel task,
 * so it hydrates the bearer cache from storage first.
 */

import { getToken, loadToken } from "../../lib/auth";
import { jobsApi } from "../../lib/jobsApi";
import { isDefinitiveRejection } from "../../lib/syncClassification";
import {
  markTravelSamplesDone,
  pendingTravelSamples,
  removeTravelSamples,
} from "./travelQueue";

const MAX_BATCH = 100; // the server's per-request cap

let syncing = false;

export async function syncTravelSamples(techId: string | null): Promise<void> {
  if (syncing || !techId) return;
  syncing = true;
  try {
    if (!getToken()) await loadToken();

    // Shared-device rule: only the signed-in tech's samples flush.
    const mine = (await pendingTravelSamples()).filter((s) => s.tech_id === techId);
    if (mine.length === 0) return;

    const byJob = new Map<string, typeof mine>();
    for (const s of mine) {
      const group = byJob.get(s.job_id) ?? [];
      group.push(s);
      byJob.set(s.job_id, group);
    }

    const settled: string[] = [];
    let offline = false;
    for (const [jobId, samples] of byJob) {
      for (let i = 0; i < samples.length; i += MAX_BATCH) {
        const batch = samples.slice(i, i + MAX_BATCH);
        try {
          await jobsApi.recordTravelSamples(
            jobId,
            batch.map((s) => ({
              client_id: s.client_id,
              leg: s.leg,
              lat: s.lat,
              lng: s.lng,
              accuracy_m: s.accuracy_m,
              is_mock: s.is_mock,
              captured_at: s.captured_at,
            })),
          );
          const ids = batch.map((s) => s.client_id);
          await markTravelSamplesDone(ids);
          settled.push(...ids);
        } catch (e) {
          if (isDefinitiveRejection(e)) {
            // Rejected outright (job reassigned/closed, out-of-window batch):
            // retrying can never succeed — drop it, the estimate stands in.
            const ids = batch.map((s) => s.client_id);
            await markTravelSamplesDone(ids);
            settled.push(...ids);
            continue;
          }
          // Offline / 5xx / 429 / 401: stop the whole drain; everything left
          // (this job's remaining batches AND other jobs) waits for the next
          // trigger — never dropped here.
          offline = true;
          break;
        }
      }
      if (offline) break;
    }
    await removeTravelSamples(settled);
  } finally {
    syncing = false;
  }
}
