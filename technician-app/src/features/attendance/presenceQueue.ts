/**
 * The offline queue for passive geofence crossings (arrive / depart), persisted
 * in AsyncStorage. A crossing is written here the instant the phone detects it —
 * including from the headless background geofence task, with no app UI open. The
 * sync (`presenceSync.ts`) drains it to the backend when the network and a
 * signed-in session are available.
 *
 * Deliberately a sibling of the punch queue (`queue.ts`), not a merge: a
 * crossing is evidence of where the phone was, never a clock-in, and the two
 * must never be confused. Same shape of guarantees, though — `client_id`
 * idempotency and a mutex so interleaved load-modify-saves don't drop a writer.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { PresenceKind } from "../../lib/attendanceApi";
import { createMutex } from "../../lib/mutex";

export interface QueuedPresence {
  client_id: string; // idempotency key (also dedups server-side)
  tech_id: string;
  shop_id: string;
  kind: PresenceKind;
  device_time: string; // ISO — the phone's clock at the crossing (server flags drift)
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  is_mock_location: boolean;
  wifi_bssid: string | null;
  wifi_ssid: string | null;
  // Crossing confirmation (D5): true = a fresh fix agreed with the OS event,
  // false = it contradicted (kept as evidence), null = unconfirmable.
  confirmed: boolean | null;
  // ── sync state ──
  done: boolean;
  created_at: string;
  // ── failure state (mirrors the punch queue / jobs outbox) ──
  attempts?: number;
  failed_reason?: string;
  failed_at?: string;
}

const KEY = "attendance.presence.queue.v1";

const locked = createMutex();

export async function loadPresenceQueue(): Promise<QueuedPresence[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedPresence[];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueuedPresence[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

async function mutate(fn: (items: QueuedPresence[]) => QueuedPresence[]): Promise<void> {
  await locked(async () => {
    await saveQueue(fn(await loadPresenceQueue()));
  });
}

export async function enqueuePresence(item: QueuedPresence): Promise<void> {
  await mutate((items) => {
    if (items.some((i) => i.client_id === item.client_id)) return items; // local dedup
    items.push(item);
    return items;
  });
}

export async function markPresenceDone(clientId: string): Promise<void> {
  await mutate((items) =>
    items.map((i) => (i.client_id === clientId ? { ...i, done: true } : i)),
  );
}

/** Drop fully-synced crossings (cheap — no local files attached, unlike punches). */
export async function removePresence(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const drop = new Set(clientIds);
  await mutate((items) => items.filter((i) => !drop.has(i.client_id)));
}

export async function pendingPresence(): Promise<QueuedPresence[]> {
  return (await loadPresenceQueue()).filter((i) => !i.done && i.failed_reason === undefined);
}

/** Crossings parked in the visible "did not sync" list. */
export async function failedPresence(): Promise<QueuedPresence[]> {
  return (await loadPresenceQueue()).filter((i) => i.failed_reason !== undefined && !i.done);
}

export async function markPresenceFailed(clientId: string, reason: string): Promise<void> {
  await mutate((items) =>
    items.map((i) =>
      i.client_id === clientId
        ? { ...i, failed_reason: reason, failed_at: new Date().toISOString() }
        : i,
    ),
  );
}

/** Bump the server-error attempt counter and return the new total. */
export async function bumpPresenceAttempts(clientId: string): Promise<number> {
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

/** Clear the failed state so the next sync retries the crossing. */
export async function retryPresence(clientId: string): Promise<void> {
  await mutate((items) =>
    items.map((i) =>
      i.client_id === clientId
        ? { ...i, failed_reason: undefined, failed_at: undefined, attempts: 0 }
        : i,
    ),
  );
}

/** Permanently drop a discarded crossing (no local files to clean, unlike a punch). */
export async function discardPresence(clientId: string): Promise<void> {
  await removePresence([clientId]);
}
