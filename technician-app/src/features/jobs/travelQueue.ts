/**
 * The offline queue for job-travel breadcrumbs (0035), persisted in
 * AsyncStorage. A sample is written the instant the background travel task
 * delivers a fix; `travelSync.ts` drains it in batches when the network is up.
 *
 * Like the on-duty ping queue — and unlike the punch/presence queues — this
 * one is DELIBERATELY droppable: capped oldest-first, and a definitively
 * rejected batch is dropped. A lost breadcrumb degrades honestly (the fuel
 * line falls back to the straight-line × circuity estimate server-side); it
 * can never fabricate distance.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createMutex } from "../../lib/mutex";

export interface QueuedTravelSample {
  client_id: string; // idempotency key (also dedups server-side)
  job_id: string;
  tech_id: string;
  leg: "outbound" | "return" | "delivery";
  lat: number;
  lng: number;
  accuracy_m: number | null;
  is_mock: boolean;
  captured_at: string; // ISO — device clock at the fix
  // ── sync state ──
  done: boolean;
  created_at: string;
}

const KEY = "jobs.travel.queue.v1";

// A 4h drive at one sample/20s is ~720 rows; 1000 bounds a phone that queued
// across several offline jobs without ever growing unbounded.
export const MAX_UNSENT_SAMPLES = 1000;

const locked = createMutex();

export async function loadTravelQueue(): Promise<QueuedTravelSample[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedTravelSample[];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueuedTravelSample[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

async function mutate(
  fn: (items: QueuedTravelSample[]) => QueuedTravelSample[],
): Promise<void> {
  await locked(async () => {
    await saveQueue(fn(await loadTravelQueue()));
  });
}

export async function enqueueTravelSample(item: QueuedTravelSample): Promise<void> {
  await mutate((items) => {
    if (items.some((i) => i.client_id === item.client_id)) return items; // local dedup
    items.push(item);
    const unsent = items.filter((i) => !i.done);
    if (unsent.length > MAX_UNSENT_SAMPLES) {
      const drop = new Set(
        [...unsent]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, unsent.length - MAX_UNSENT_SAMPLES)
          .map((i) => i.client_id),
      );
      return items.filter((i) => !drop.has(i.client_id));
    }
    return items;
  });
}

export async function markTravelSamplesDone(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const done = new Set(clientIds);
  await mutate((items) => items.map((i) => (done.has(i.client_id) ? { ...i, done: true } : i)));
}

export async function removeTravelSamples(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const drop = new Set(clientIds);
  await mutate((items) => items.filter((i) => !drop.has(i.client_id)));
}

export async function pendingTravelSamples(): Promise<QueuedTravelSample[]> {
  return (await loadTravelQueue()).filter((i) => !i.done);
}
