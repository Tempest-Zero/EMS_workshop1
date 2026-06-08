/**
 * Drains the job outbox to the backend and provides `sendOrQueue` — the single
 * wrapper every offline-capable job write goes through:
 *   online  → send now, return the authoritative JobDetail.
 *   offline / network failure → queue it, return null (UI shows "saved offline").
 *   server (4xx) error → rethrow (a real validation error, not a connectivity one).
 *
 * Replays are idempotent (client_id dedup / upsert), so a queued write that
 * actually reached the server before the response was lost won't double-apply.
 */

import NetInfo from "@react-native-community/netinfo";

import {
  bumpAttempts,
  enqueue,
  loadOutbox,
  removeItem,
  type OutboxItem,
  type OutboxKind,
} from "./outbox";
import { jobsApi, type JobDetail, type LocationInput } from "./jobsApi";

interface CompletionPayload {
  body: Parameters<typeof jobsApi.submitCompletion>[1];
}
interface PaymentPayload {
  amountPaisa: number;
  method: string;
  clientId: string;
}
interface VoidPayload {
  paymentId: string;
  reason: string;
}
interface NegotiatePayload {
  amountPaisa: number;
  note?: string;
}
interface LocationPayload {
  body: LocationInput;
}

/** Replay one queued item via the matching jobs API call. */
async function send(item: OutboxItem): Promise<JobDetail> {
  switch (item.kind) {
    case "completion":
      return jobsApi.submitCompletion(item.jobId, (item.payload as CompletionPayload).body);
    case "payment": {
      const p = item.payload as PaymentPayload;
      return jobsApi.logPayment(item.jobId, p.amountPaisa, p.method, p.clientId);
    }
    case "void": {
      const p = item.payload as VoidPayload;
      return jobsApi.voidPayment(item.jobId, p.paymentId, p.reason);
    }
    case "negotiate": {
      const p = item.payload as NegotiatePayload;
      return jobsApi.negotiateBill(item.jobId, p.amountPaisa, p.note);
    }
    case "location":
      return jobsApi.recordLocation(item.jobId, (item.payload as LocationPayload).body);
  }
}

function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /Network request failed|timed out|Failed to fetch|Network Error/i.test(msg);
}

let syncing = false;

/** Drain the queue in order. Stops at the first connectivity failure (keeps
 * order, retries later); drops a poison 4xx item so it can't block the queue. */
export async function flushOutbox(): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    for (const item of await loadOutbox()) {
      try {
        await send(item);
        await removeItem(item.id);
      } catch (e) {
        if (isNetworkError(e)) {
          await bumpAttempts(item.id);
          break; // still offline — leave the rest queued, retry on next trigger
        }
        // Non-connectivity (server) error: this item will never succeed on
        // replay — drop it so it can't wedge the queue.
        await removeItem(item.id);
      }
    }
  } finally {
    syncing = false;
  }
}

export async function sendOrQueue(
  item: OutboxItem,
  call: () => Promise<JobDetail>,
): Promise<JobDetail | null> {
  const net = await NetInfo.fetch();
  if (net.isConnected === false) {
    await enqueue(item);
    return null;
  }
  try {
    return await call();
  } catch (e) {
    if (isNetworkError(e)) {
      await enqueue(item);
      return null;
    }
    throw e; // real server error → surface it
  }
}

export type {
  CompletionPayload,
  PaymentPayload,
  VoidPayload,
  NegotiatePayload,
  LocationPayload,
  OutboxKind,
};
