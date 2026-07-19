/**
 * In-memory freshness layer over `jobsApi.list()`. The four job-list routes
 * all render the same screen, so hopping between category tabs used to refetch
 * the full list every time (~1s per hop on our network). Within FRESH_MS the
 * last server copy is served as-is and concurrent callers share one in-flight
 * request. AsyncStorage (`jobsCache`) stays the offline fallback — this layer
 * only decides whether to hit the network at all, and writes through to the
 * persistent cache on every successful fetch exactly like the screen used to.
 */

import { jobsApi, type Job } from "./jobsApi";
import { saveJobsList } from "./jobsCache";

const FRESH_MS = 15_000;

let last: { data: Job[]; fetchedAt: number } | null = null;
let inflight: Promise<Job[]> | null = null;

/** Last fetched list for instant first paint, or null before the first load. */
export function peekJobsList(): Job[] | null {
  return last?.data ?? null;
}

export function invalidateJobsList(): void {
  last = null;
}

export async function getJobsList(opts: { force?: boolean } = {}): Promise<Job[]> {
  if (!opts.force && last && Date.now() - last.fetchedAt < FRESH_MS) {
    return last.data;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const all = await jobsApi.list();
      last = { data: all, fetchedAt: Date.now() };
      void saveJobsList(all);
      return all;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function _resetJobsMemoForTests(): void {
  last = null;
  inflight = null;
}
