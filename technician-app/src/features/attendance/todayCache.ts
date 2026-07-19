/**
 * Shared memo over `attendanceApi.today` — the duty badge (Dashboard), the
 * Clock screen and the headless geofence task all need the same answer, and
 * used to each fetch it independently on every focus/event. Within FRESH_MS
 * they share one copy; concurrent callers share one in-flight request.
 *
 * Mutation paths (punch, sync of queued punches) MUST call `invalidateToday`
 * before re-reading — a punch changes the server truth this caches.
 */

import { attendanceApi, type TodayStatus } from "../../lib/attendanceApi";

const FRESH_MS = 30_000;

const entries = new Map<string, { value: TodayStatus; fetchedAt: number }>();
const inflight = new Map<string, Promise<TodayStatus>>();

export async function getToday(
  techId: string,
  opts: { force?: boolean } = {},
): Promise<TodayStatus> {
  const cached = entries.get(techId);
  if (!opts.force && cached && Date.now() - cached.fetchedAt < FRESH_MS) {
    return cached.value;
  }
  const pending = inflight.get(techId);
  if (pending) return pending;
  const req = (async () => {
    try {
      const value = await attendanceApi.today(techId);
      entries.set(techId, { value, fetchedAt: Date.now() });
      return value;
    } finally {
      inflight.delete(techId);
    }
  })();
  inflight.set(techId, req);
  return req;
}

/** Drop the cached status for one tech (or everyone when null/omitted). */
export function invalidateToday(techId?: string | null): void {
  if (techId) {
    entries.delete(techId);
  } else {
    entries.clear();
  }
}

export function _resetTodayCacheForTests(): void {
  entries.clear();
  inflight.clear();
}
