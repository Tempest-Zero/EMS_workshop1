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

export async function pendingPunches(): Promise<QueuedPunch[]> {
  return (await loadQueue()).filter((i) => !i.done);
}
