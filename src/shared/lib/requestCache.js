/**
 * Tiny TTL + in-flight-dedupe cache for GET-style API calls that several
 * screens request independently (e.g. selfie-gaps is needed by Dashboard and
 * Attendance). Not a general data layer — the app deliberately stays on plain
 * fetch + context; this only stops the same read being paid for twice within
 * a short window (~0.7s per round trip on our network).
 */

const entries = new Map(); // key -> { value, at }
const inflight = new Map(); // key -> Promise

export function cached(key, fn, { ttlMs }) {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  const pending = inflight.get(key);
  if (pending) return pending;
  const req = Promise.resolve(fn()).then(
    (value) => {
      entries.set(key, { value, at: Date.now() });
      inflight.delete(key);
      return value;
    },
    (e) => {
      inflight.delete(key); // failures are never cached
      throw e;
    }
  );
  inflight.set(key, req);
  return req;
}

export function invalidate(key) {
  entries.delete(key);
}

export function _resetRequestCacheForTests() {
  entries.clear();
  inflight.clear();
}
