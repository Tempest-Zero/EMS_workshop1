/**
 * A tiny async mutex (promise chain). Both offline stores (the jobs outbox and
 * the attendance punch queue) mutate AsyncStorage via load-modify-save on a
 * single key; two such mutations interleaving across their awaits silently
 * lose one writer's update — for the outbox that can be a queued CASH record
 * (e.g. the background flush removing a synced item while the technician logs
 * a payment). Serialising every critical section through one chain makes each
 * load-modify-save atomic. Per-store instances: the two stores use different
 * keys, so they need ordering within themselves, not with each other.
 */

export type Mutex = <T>(criticalSection: () => Promise<T>) => Promise<T>;

export function createMutex(): Mutex {
  let chain: Promise<unknown> = Promise.resolve();
  return function locked<T>(criticalSection: () => Promise<T>): Promise<T> {
    // Run after everything queued so far — whether it settled or failed.
    const run = chain.then(criticalSection, criticalSection);
    // The chain itself must never stay rejected, or every later section
    // would inherit the failure; callers still see their own rejection
    // through `run`.
    chain = run.catch(() => undefined);
    return run;
  };
}
