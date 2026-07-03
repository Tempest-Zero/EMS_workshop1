/**
 * The offline queue for on-duty location pings, persisted in AsyncStorage. A
 * ping is written here the instant the background location task samples a fix —
 * including from a headless context with no app UI open. `pingSync.ts` drains it
 * to the backend in batches when the network and a signed-in session are up.
 *
 * A DELIBERATE exception to "the queue never drops an unsent write" (which the
 * punch + presence queues honour): the unsent list is capped at
 * `MAX_UNSENT_PINGS`, oldest-first. A punch is money and a crossing is evidence —
 * neither may be lost — but a dropped ping degrades honestly into a "no data"
 * gap server-side (it can never fabricate presence OR absence), so bounding the
 * queue on a phone that's been offline for days is the right trade.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createMutex } from "../../lib/mutex";

export interface QueuedPing {
  client_id: string; // idempotency key (also dedups server-side)
  tech_id: string;
  shop_id: string;
  captured_at: string; // ISO — the device clock at the sample (the analytical axis)
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

const KEY = "attendance.pings.queue.v1";

// The one place the attendance queues bound themselves — see the file header.
export const MAX_UNSENT_PINGS = 1000;

const locked = createMutex();

export async function loadPingQueue(): Promise<QueuedPing[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as QueuedPing[];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueuedPing[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

async function mutate(fn: (items: QueuedPing[]) => QueuedPing[]): Promise<void> {
  await locked(async () => {
    await saveQueue(fn(await loadPingQueue()));
  });
}

export async function enqueuePing(item: QueuedPing): Promise<void> {
  await mutate((items) => {
    if (items.some((i) => i.client_id === item.client_id)) return items; // local dedup
    items.push(item);
    // Cap the UNSENT backlog oldest-first (see header). Synced-but-not-yet-pruned
    // rows aren't counted — they're about to be removed by the sync sweep.
    const unsent = items.filter((i) => !i.done);
    if (unsent.length > MAX_UNSENT_PINGS) {
      const drop = new Set(
        [...unsent]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .slice(0, unsent.length - MAX_UNSENT_PINGS)
          .map((i) => i.client_id),
      );
      return items.filter((i) => !drop.has(i.client_id));
    }
    return items;
  });
}

export async function markPingsDone(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const done = new Set(clientIds);
  await mutate((items) =>
    items.map((i) => (done.has(i.client_id) ? { ...i, done: true } : i)),
  );
}

/** Drop fully-synced pings (cheap — no local files attached, unlike punches). */
export async function removePings(clientIds: string[]): Promise<void> {
  if (clientIds.length === 0) return;
  const drop = new Set(clientIds);
  await mutate((items) => items.filter((i) => !drop.has(i.client_id)));
}

export async function pendingPings(): Promise<QueuedPing[]> {
  return (await loadPingQueue()).filter((i) => !i.done);
}
