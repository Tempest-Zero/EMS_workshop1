/**
 * The offline punch queue, persisted in AsyncStorage. A punch is written here
 * the instant the technician taps the button — that local write IS the "success"
 * the UI shows. The background sync (`sync.ts`) drains it when the network is
 * available. Conflict resolution is trivial (a tech owns their own punches), so
 * it's plain last-write-wins keyed by a client-generated UUID — no CRDTs.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PunchKind } from "../../lib/attendanceApi";
import { createMutex } from "../../lib/mutex";

export interface QueuedPunch {
  client_id: string; // idempotency key (also dedups server-side)
  tech_id: string;
  shop_id: string;
  kind: PunchKind;
  device_time: string; // ISO — the phone's clock at capture (server flags drift)
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  is_mock_location: boolean;
  wifi_bssid: string | null;
  wifi_ssid: string | null;
  selfie_uri: string | null; // durable local file:// path
  selfie_filename: string | null;
  selfie_content_type: string | null;
  // ── sync state ──
  server_event_id: string | null;
  selfie_done: boolean;
  done: boolean;
  created_at: string;
  // ── failure state (mirrors the jobs outbox) ──
  // A definitive 4xx (or a 5xx that exhausted MAX_ATTEMPTS) parks the punch in
  // a visible "did not sync" list instead of retrying it forever. `attempts`
  // counts only server-reachable 5xx/429 errors — never network/timeout.
  attempts?: number;
  failed_reason?: string;
  failed_at?: string;
}

const KEY = "attendance.queue.v1";

// Serialises the load-modify-saves below: two interleaving across their awaits
// (e.g. the background sync marking a punch done while a fresh punch enqueues)
// silently drops one writer's update. Reads stay unlocked — a single-key
// getItem sees either the old or the new full JSON, never a torn one.
const locked = createMutex();

export async function loadQueue(): Promise<QueuedPunch[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedPunch[];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueuedPunch[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

/** Atomically load-modify-save under the mutex. */
async function mutate(fn: (items: QueuedPunch[]) => QueuedPunch[]): Promise<void> {
  await locked(async () => {
    await saveQueue(fn(await loadQueue()));
  });
}

export async function enqueue(item: QueuedPunch): Promise<void> {
  await mutate((items) => {
    if (items.some((i) => i.client_id === item.client_id)) return items; // local dedup
    items.push(item);
    return items;
  });
}

export async function updatePunch(
  clientId: string,
  patch: Partial<QueuedPunch>,
): Promise<void> {
  await mutate((items) =>
    items.map((i) => (i.client_id === clientId ? { ...i, ...patch } : i)),
  );
}

/** Drop fully-settled punches from the queue (the sync sweep — the entries
 * have served their purpose once the server has everything). */
export async function removePunches(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const drop = new Set(clientIds);
  await mutate((items) => items.filter((i) => !drop.has(i.client_id)));
}

/** Not yet settled AND not parked as failed — these are what the sync drains
 * and the pending badge counts. A failed punch waits for the technician to
 * Retry or Discard it (mirrors the jobs outbox). */
export async function pendingPunches(): Promise<QueuedPunch[]> {
  return (await loadQueue()).filter((i) => !i.done && i.failed_reason === undefined);
}

/** Punches parked in the visible "did not sync" list. */
export async function failedPunches(): Promise<QueuedPunch[]> {
  return (await loadQueue()).filter((i) => i.failed_reason !== undefined && !i.done);
}

/** Park a punch as failed (definitive rejection or exhausted retries). */
export async function markPunchFailed(clientId: string, reason: string): Promise<void> {
  await updatePunch(clientId, { failed_reason: reason, failed_at: new Date().toISOString() });
}

/** Bump the server-error attempt counter and return the new total. */
export async function bumpPunchAttempts(clientId: string): Promise<number> {
  let next = 0;
  await mutate((items) =>
    items.map((i) => {
      if (i.client_id !== clientId) return i;
      next = (i.attempts ?? 0) + 1;
      return { ...i, attempts: next };
    }),
  );
  return next;
}

/** Clear the failed state so the next sync retries the punch. */
export async function retryPunch(clientId: string): Promise<void> {
  await mutate((items) =>
    items.map((i) =>
      i.client_id === clientId
        ? { ...i, failed_reason: undefined, failed_at: undefined, attempts: 0 }
        : i,
    ),
  );
}
