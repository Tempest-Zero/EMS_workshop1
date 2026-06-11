/**
 * Offline READ cache for jobs — the last server truth, persisted so a
 * technician with no signal can still see their work list and, crucially, a
 * job's customer address/phone/problem in the field. Writes were already
 * offline-safe (the outbox); reads previously just errored on a cold start.
 *
 * Semantics: a cached copy is clearly stale data — every consumer gets the
 * `savedAt` stamp and must say so in the UI (the "offline copy" banner). The
 * cache is best-effort: a storage failure never breaks the live path, and a
 * corrupt entry reads as "no cache". Details are pruned to the ids in the
 * last saved list so the store can't grow unboundedly.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Job, JobDetail } from "./jobsApi";

const LIST_KEY = "jobs.cache.list.v1";
const DETAIL_PREFIX = "jobs.cache.detail.v1:";

export interface CachedCopy<T> {
  /** ISO timestamp of when this copy was fetched from the server. */
  savedAt: string;
  data: T;
}

async function read<T>(key: string): Promise<CachedCopy<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedCopy<T>;
  } catch {
    return null; // corrupt/unreadable cache = no cache
  }
}

export async function saveJobsList(jobs: Job[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      LIST_KEY,
      JSON.stringify({ savedAt: new Date().toISOString(), data: jobs }),
    );
    await pruneDetails(new Set(jobs.map((j) => j.id)));
  } catch {
    // Best-effort: a failed cache write must never break the live screen.
  }
}

export async function loadJobsList(): Promise<CachedCopy<Job[]> | null> {
  return read<Job[]>(LIST_KEY);
}

export async function saveJobDetail(detail: JobDetail): Promise<void> {
  try {
    await AsyncStorage.setItem(
      DETAIL_PREFIX + detail.id,
      JSON.stringify({ savedAt: new Date().toISOString(), data: detail }),
    );
  } catch {
    // Best-effort.
  }
}

export async function loadJobDetail(id: string): Promise<CachedCopy<JobDetail> | null> {
  return read<JobDetail>(DETAIL_PREFIX + id);
}

/** Drop cached details for jobs no longer in the server list, so the cache
 * tracks the working set instead of accumulating forever. */
async function pruneDetails(liveIds: Set<string>): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const stale = keys.filter(
    (k) => k.startsWith(DETAIL_PREFIX) && !liveIds.has(k.slice(DETAIL_PREFIX.length)),
  );
  if (stale.length > 0) await AsyncStorage.multiRemove(stale);
}

/** Short human stamp for the offline banner ("Jun 11, 9:40 AM"). */
export function cacheStamp(savedAt: string): string {
  return new Date(savedAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
