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
  // ── sync state ──
  done: boolean;
  created_at: string;
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
  return (await loadPresenceQueue()).filter((i) => !i.done);
}
