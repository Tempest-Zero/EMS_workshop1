/**
 * Voice notes (and future media) captured for a job that doesn't exist
 * server-side yet — an offline-queued create — or whose upload failed after
 * an online create. The outbox contract applies: NOTHING here is silently
 * dropped. Entries drain once the job row exists (matched by the create's
 * client_id, which the Job read model echoes since 0036).
 *
 * Storage keyed like the other queues; load-modify-save serialized by the
 * shared mutex pattern.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { ApiError, type Phase } from "../../lib/api";
import { jobsApi } from "../../lib/jobsApi";
import { createMutex } from "../../lib/mutex";
import { isDefinitiveRejection, MAX_ATTEMPTS } from "../../lib/syncClassification";
import { uploadMedia } from "./uploadMedia";

export interface PendingMediaItem {
  id: string;
  /** The create's client_id — the join key to the eventual server job. */
  jobClientId: string;
  phase: Phase;
  type: "audio" | "photo" | "video";
  uri: string;
  filename: string;
  contentType: string;
  createdAt: string;
  attempts: number;
  /** Set when the server rejected it definitively — waiting on the tech. */
  failedReason?: string;
}

const KEY = "media.pending.v1";
const mutex = createMutex();

async function load(): Promise<PendingMediaItem[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PendingMediaItem[]) : [];
  } catch {
    return [];
  }
}

async function save(items: PendingMediaItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function enqueuePendingMedia(
  item: Omit<PendingMediaItem, "createdAt" | "attempts">,
): Promise<void> {
  await mutex(async () => {
    const items = await load();
    if (items.some((i) => i.id === item.id)) return; // idempotent
    items.push({ ...item, createdAt: new Date().toISOString(), attempts: 0 });
    await save(items);
  });
}

export async function listPendingMedia(): Promise<PendingMediaItem[]> {
  return load();
}

export async function pendingMediaCount(): Promise<number> {
  return (await load()).length;
}

async function removeEntry(id: string): Promise<void> {
  await mutex(async () => {
    await save((await load()).filter((i) => i.id !== id));
  });
}

async function recordFailure(id: string, reason: string, park: boolean): Promise<void> {
  await mutex(async () => {
    const items = await load();
    const target = items.find((i) => i.id === id);
    if (!target) return;
    target.attempts = park ? MAX_ATTEMPTS : target.attempts + 1;
    target.failedReason = reason;
    await save(items);
  });
}

let draining = false;

/**
 * Try to upload everything whose job now exists. Safe to call often (outbox
 * change, foreground, reconnect) — it no-ops fast when the queue is empty and
 * stops at the first connectivity failure.
 */
export async function drainPendingMedia(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const items = await load();
    if (items.length === 0) return;

    // One roster fetch resolves every entry's client_id → token join.
    let jobs;
    try {
      jobs = await jobsApi.list();
    } catch {
      return; // offline — every entry keeps waiting
    }

    for (const item of items) {
      if (item.attempts >= MAX_ATTEMPTS) continue; // parked — visible via list
      const job = jobs.find((j) => j.client_id === item.jobClientId);
      if (!job) continue; // its create hasn't synced yet

      try {
        await uploadMedia({
          jobId: String(job.token),
          phase: item.phase,
          type: item.type,
          uri: item.uri,
          filename: item.filename,
          contentType: item.contentType,
        });
        await removeEntry(item.id);
      } catch (e) {
        // 413 isn't in the shared definitive set (queues never send bodies
        // that can outgrow a limit) — but here it means "this file is too
        // large and always will be": definitively parked.
        const tooLarge = e instanceof ApiError && e.status === 413;
        if (isDefinitiveRejection(e) || tooLarge) {
          // Rejected outright (bad phase / too large): park it visibly — the
          // outbox rule, never a silent drop. A definitive rejection would
          // repeat forever, so it parks immediately.
          await recordFailure(
            item.id,
            e instanceof ApiError ? `rejected by the server (${e.status})` : "rejected",
            true,
          );
          continue;
        }
        if (e instanceof ApiError) {
          await recordFailure(item.id, `server ${e.status}`, false);
          continue; // 5xx on this item — the next entry may still land
        }
        break; // pure connectivity failure — retry the lot next trigger
      }
    }
  } finally {
    draining = false;
  }
}
