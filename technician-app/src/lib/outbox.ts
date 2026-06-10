/**
 * The offline outbox for **job writes** (completion, cash, void, negotiate, GPS
 * punch, mark-ready, notes). Generalises the attendance offline pattern so
 * "offline is non-negotiable" holds for job logging + forms, not just clock-ins.
 *
 * A write the technician makes is recorded here the instant they tap — that
 * local write IS the success the UI shows. `outboxSync` drains it to the backend
 * when the network is available. Money kinds are **idempotent server-side**
 * (client_id dedup or upsert), so replaying on reconnect is safe; the queue is
 * keyed by a stable id so re-doing the same action offline is last-write-wins.
 *
 * v2 (the data-loss fix): an item the server definitively rejects is moved to a
 * visible **failed** state — Retry / Discard is the technician's call. Nothing
 * is ever silently deleted; this queue can hold real cash records. Items are
 * tagged with the technician who queued them so a shared device never flushes
 * one person's writes under another's session.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type OutboxKind =
  | "completion"
  | "payment"
  | "void"
  | "negotiate"
  | "location"
  | "ready"
  | "note";

export type OutboxStatus = "queued" | "failed";

export interface OutboxItem {
  /** Stable dedup/idempotency key (e.g. `completion:<jobId>`, or a payment uuid). */
  id: string;
  kind: OutboxKind;
  jobId: string;
  /** Kind-specific args; `outboxSync.send` maps these back to the jobs API call. */
  payload: unknown;
  createdAt: string;
  attempts: number;
  /** Who queued it. `null` only on items restored from the v1 store — they are
   * adopted by the next signed-in technician (the device's owner in practice). */
  techId: string | null;
  /** `queued` = will sync; `failed` = server rejected it definitively, waiting
   * for the technician to Retry or Discard. */
  status: OutboxStatus;
  /** Short server reason shown in the failed list. */
  failedReason?: string;
  failedAt?: string;
}

export interface OutboxCounts {
  queued: number;
  failed: number;
}

const KEY_V2 = "jobs.outbox.v2";
const KEY_V1 = "jobs.outbox.v1";
/** A v1 store that fails to parse is preserved here verbatim, never discarded —
 * it may hold real cash records someone will want to recover by hand. */
const KEY_V1_CORRUPT = "jobs.outbox.v1.corrupt";

// ── Current principal (set by AuthContext on restore/login/logout) ───────────
let currentTechId: string | null = null;

export function setOutboxPrincipal(techId: string | null): void {
  currentTechId = techId;
}

export function getOutboxPrincipal(): string | null {
  return currentTechId;
}

// ── Change feed ───────────────────────────────────────────────────────────────
type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to outbox changes (enqueue / drain / fail / retry). Returns an
 * unsubscribe fn. */
export function onOutboxChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

// ── Load (with the v1 → v2 migration) ────────────────────────────────────────
type V1Item = Omit<OutboxItem, "techId" | "status">;

export async function loadOutbox(): Promise<OutboxItem[]> {
  const raw = await AsyncStorage.getItem(KEY_V2);
  let items: OutboxItem[] = [];
  if (raw) {
    try {
      items = JSON.parse(raw) as OutboxItem[];
    } catch {
      items = [];
    }
  }

  // One-time v1 migration. MERGE, never replace: both stores can coexist if the
  // app crashed mid-migration, and neither may lose a record.
  const rawV1 = await AsyncStorage.getItem(KEY_V1);
  if (rawV1 !== null) {
    try {
      const v1 = JSON.parse(rawV1) as V1Item[];
      for (const old of v1) {
        if (!items.some((i) => i.id === old.id)) {
          items.push({ ...old, techId: null, status: "queued" });
        }
      }
    } catch {
      // Unparseable v1 store: keep the bytes, just out of the hot path.
      await AsyncStorage.setItem(KEY_V1_CORRUPT, rawV1);
    }
    await AsyncStorage.setItem(KEY_V2, JSON.stringify(items));
    await AsyncStorage.removeItem(KEY_V1);
  }

  return items;
}

async function save(items: OutboxItem[]): Promise<void> {
  await AsyncStorage.setItem(KEY_V2, JSON.stringify(items));
  notify();
}

/** Add (or replace, by id) a queued write. Replacing gives last-write-wins for
 * stable-id kinds (completion/negotiate/location/ready); payments and notes use
 * unique ids so each appends. */
export async function enqueue(item: OutboxItem): Promise<void> {
  const items = await loadOutbox();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx === -1) items.push(item);
  else items[idx] = item;
  await save(items);
}

/** Build a new item with the session's tech stamped on. */
export function makeItem(
  fields: Pick<OutboxItem, "id" | "kind" | "jobId" | "payload">,
): OutboxItem {
  return {
    ...fields,
    createdAt: new Date().toISOString(),
    attempts: 0,
    techId: currentTechId,
    status: "queued",
  };
}

export async function removeItem(id: string): Promise<void> {
  await save((await loadOutbox()).filter((i) => i.id !== id));
}

export async function bumpAttempts(id: string): Promise<void> {
  await save(
    (await loadOutbox()).map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1 } : i)),
  );
}

/** A definitive server rejection: park the item in the visible failed list.
 * The technician decides what happens next (Retry / Discard) — the app never
 * deletes a record on its own. */
export async function markFailed(id: string, reason: string): Promise<void> {
  await save(
    (await loadOutbox()).map((i) =>
      i.id === id
        ? { ...i, status: "failed" as const, failedReason: reason, failedAt: new Date().toISOString() }
        : i,
    ),
  );
}

/** Put a failed item back in the queue (fresh attempt count). */
export async function retryItem(id: string): Promise<void> {
  await save(
    (await loadOutbox()).map((i) =>
      i.id === id
        ? { ...i, status: "queued" as const, attempts: 0, failedReason: undefined, failedAt: undefined }
        : i,
    ),
  );
}

/** Permanent removal — only ever called from an explicit user confirmation. */
export async function discardItem(id: string): Promise<void> {
  await removeItem(id);
}

/** Adopt legacy (v1, untagged) items into the given session. */
export async function adoptLegacyItems(techId: string): Promise<void> {
  const items = await loadOutbox();
  if (!items.some((i) => i.techId === null)) return;
  await save(items.map((i) => (i.techId === null ? { ...i, techId } : i)));
}

export async function outboxCounts(): Promise<OutboxCounts> {
  const items = await loadOutbox();
  return {
    queued: items.filter((i) => i.status === "queued").length,
    failed: items.filter((i) => i.status === "failed").length,
  };
}

/** Everything queued/failed against one job — the Job Detail pending overlay. */
export async function itemsForJob(jobId: string): Promise<OutboxItem[]> {
  return (await loadOutbox()).filter((i) => i.jobId === jobId);
}
