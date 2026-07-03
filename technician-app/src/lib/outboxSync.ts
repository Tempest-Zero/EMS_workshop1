/**
 * Drains the job outbox to the backend and provides `sendOrQueue` — the single
 * wrapper every offline-capable job write goes through:
 *   online           → send now, return the authoritative JobDetail.
 *   offline / network / transient server error (5xx, 429, timeout)
 *                    → queue it, return null (UI shows "saved offline").
 *   definitive 4xx on a live tap → rethrow (a real validation error the
 *                      technician is looking at — not a queueing matter).
 *
 * Flush classification (the v1 silent-drop fix — every branch is deliberate):
 *   success          → remove from queue.
 *   401              → PAUSE the whole queue; items survive logout and resume
 *                      after re-login. (The token expired, not the writes.)
 *   400/403/404/409/422 → definitive rejection: move to the visible FAILED
 *                      list. Never silently deleted — these can be cash records.
 *   everything else (5xx, 429, network, timeout, unknown) → keep queued, retry
 *                      later, preserve order.
 *
 * Replays are idempotent for money kinds (client_id dedup / upsert). `ready`
 * and `note` replays are state-idempotent; a replay after a lost response can
 * at worst duplicate a timeline entry, never money.
 */

import NetInfo from "@react-native-community/netinfo";

import { ApiError } from "./api";
import {
  adoptLegacyItems,
  bumpAttempts,
  enqueue,
  getOutboxPrincipal,
  loadOutbox,
  markFailed,
  removeItem,
  type OutboxItem,
  type OutboxKind,
} from "./outbox";
import { jobsApi, type JobDetail, type LocationInput } from "./jobsApi";
import {
  failureReason,
  isAuthFailure,
  isDefinitiveRejection,
  MAX_ATTEMPTS,
} from "./syncClassification";

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
interface NotePayload {
  text: string;
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
    case "ready":
      return jobsApi.transition(item.jobId, "ready");
    case "note":
      return jobsApi.addNote(item.jobId, (item.payload as NotePayload).text);
  }
}

let syncing = false;
// 401 during a flush parks the queue until someone signs back in — flushing
// with a dead token would just 401 every item one by one.
let pausedForAuth = false;

/** Re-arm the queue after a successful (re-)login; adopts any legacy v1 items
 * into the new session. Called by AuthContext. */
export async function resumeOutbox(techId: string): Promise<void> {
  pausedForAuth = false;
  await adoptLegacyItems(techId);
}

export function isOutboxPaused(): boolean {
  return pausedForAuth;
}

/** Drain the queue in order. Stops at the first connectivity failure (keeps
 * order, retries later); definitive rejections go to the visible failed list. */
export async function flushOutbox(): Promise<void> {
  if (syncing || pausedForAuth) return;
  const me = getOutboxPrincipal();
  if (!me) return; // not signed in — nothing may send
  syncing = true;
  try {
    for (const item of await loadOutbox()) {
      if (item.status !== "queued") continue; // failed items wait for the user
      // Shared-device protection: never flush another technician's writes
      // under this session. (Legacy null-tagged items are adopted on login.)
      if (item.techId !== null && item.techId !== me) continue;
      try {
        await send(item);
        await removeItem(item.id);
      } catch (e) {
        if (isAuthFailure(e)) {
          pausedForAuth = true;
          break; // token is dead; the queue survives logout → re-login
        }
        if (isDefinitiveRejection(e)) {
          await markFailed(item.id, failureReason(e));
          continue; // a parked item must not block the ones behind it
        }
        // Server reachable but erroring on THIS item (5xx/429): count it. A
        // poison write (server keeps 500ing on one payload) would otherwise
        // block every item behind it forever, so once it exhausts MAX_ATTEMPTS
        // we park it in the visible failed list and move on — never deleted.
        if (e instanceof ApiError) {
          const attempts = await bumpAttempts(item.id);
          if (attempts >= MAX_ATTEMPTS) {
            await markFailed(item.id, `gave up after ${attempts} attempts (server ${e.status})`);
            continue; // parked → must not block the items behind it
          }
          break; // transient server blip — retry the whole queue next trigger
        }
        // Pure connectivity failure (offline / timeout / DNS) — not this item's
        // fault, never counts toward the cap. Stop; the next trigger retries.
        break;
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
    // A definitive 4xx on a live tap is a validation error the technician is
    // looking at right now — surface it. A 401 means the session just ended —
    // surface that too (the auth handler is already routing to login).
    if (isDefinitiveRejection(e) || isAuthFailure(e)) throw e;
    // Anything transient — offline, timeout, 502 mid-deploy — queues. The tap
    // succeeded as far as the technician is concerned.
    await enqueue(item);
    return null;
  }
}

export type {
  CompletionPayload,
  PaymentPayload,
  VoidPayload,
  NegotiatePayload,
  LocationPayload,
  NotePayload,
  OutboxKind,
};
