/**
 * The offline outbox for **job writes** (completion, cash, void, negotiate, GPS
 * punch). Generalises the attendance offline pattern to the rest of the app so
 * "offline is non-negotiable" holds for job logging + forms, not just clock-ins.
 *
 * A write the technician makes is recorded here the instant they tap — that
 * local write IS the success the UI shows. `outboxSync` drains it to the backend
 * when the network is available. Every kind is **idempotent server-side**
 * (client_id dedup or upsert), so replaying on reconnect is safe; the queue is
 * keyed by a stable id so re-doing the same action offline is last-write-wins.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type OutboxKind = "completion" | "payment" | "void" | "negotiate" | "location";

export interface OutboxItem {
  /** Stable dedup/idempotency key (e.g. `completion:<jobId>`, or a payment uuid). */
  id: string;
  kind: OutboxKind;
  jobId: string;
  /** Kind-specific args; `outboxSync.send` maps these back to the jobs API call. */
  payload: unknown;
  createdAt: string;
  attempts: number;
}

const KEY = "jobs.outbox.v1";

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to outbox changes (enqueue / drain). Returns an unsubscribe fn. */
export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as OutboxItem[];
  } catch {
    return [];
  }
}

async function save(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
  notify();
}

/** Add (or replace, by id) a queued write. Replacing gives last-write-wins for
 * stable-id kinds (completion/negotiate/location); payments use a unique id so
 * each appends. */
export async function enqueue(item: OutboxItem): Promise<void> {
  const items = await loadOutbox();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx === -1) items.push(item);
  else items[idx] = item;
  await save(items);
}

export async function removeItem(id: string): Promise<void> {
  await save((await loadOutbox()).filter((i) => i.id !== id));
}

export async function bumpAttempts(id: string): Promise<void> {
  await save(
    (await loadOutbox()).map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1 } : i)),
  );
}

export async function outboxCount(): Promise<number> {
  return (await loadOutbox()).length;
}
