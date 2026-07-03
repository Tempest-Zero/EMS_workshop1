/**
 * Shared error classification for every offline write queue — extracted from the
 * jobs outbox so the attendance punch/presence/ping syncs classify failures the
 * same way instead of retrying everything forever. The rule, in one place:
 *   401              → the session, not the write. Pause; never mark failed.
 *   400/403/404/409/422 → definitive: the payload will never succeed on replay.
 *   5xx / 429 / network / timeout → transient: keep queued and retry.
 * The bias is deliberate: with a visible failed list the cost of a wrong "fail"
 * is a human glance, but the cost of a wrong "drop" is silent data loss.
 */

import { ApiError } from "./api";

/** Statuses that will never succeed on replay. 401 is NOT here — that's the
 * session, not the write. Unknown/5xx/429 default to retry: with a visible
 * failed list the cost of a wrong "fail" is human attention, but the cost of a
 * wrong "drop" was silent loss — bias every ambiguity toward keeping the record. */
export const DEFINITIVE_4XX = new Set([400, 403, 404, 409, 422]);

/** A server-reachable error (5xx/429) that recurs this many times is treated as
 * a poison item: parked in the visible failed list so one bad write can't
 * head-of-line block the whole queue forever. A real deploy blip clears well
 * before this — only a write the server keeps erroring on reaches the cap. */
export const MAX_ATTEMPTS = 5;

export function isDefinitiveRejection(e: unknown): e is ApiError {
  return e instanceof ApiError && DEFINITIVE_4XX.has(e.status);
}

export function isAuthFailure(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/** Trim the server's error body down to something a human can read in a list. */
export function failureReason(e: ApiError): string {
  const detail = /"detail"\s*:\s*"([^"]+)"/.exec(e.message)?.[1];
  return detail ?? `rejected (${e.status})`;
}
