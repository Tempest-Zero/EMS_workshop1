import { useCallback, useEffect, useState } from "react";

/**
 * Poll an async `fetcher` on an interval, pausing while the tab is hidden (so a
 * backgrounded console doesn't keep hammering Railway/Sentry through the proxy).
 *
 * The `fetcher` must be stable — wrap it in `useCallback` at the call site so a
 * changing dependency (e.g. the selected service) re-subscribes correctly.
 *
 * Returns `{ data, error, loading, refresh }`. `error` is the thrown Error;
 * `data` holds the last successful payload (kept across a transient failure).
 */
export function usePolling(fetcher, intervalMs = 15000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(() => {
    return fetcher()
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  }, [fetcher]);

  useEffect(() => {
    let active = true;
    let timer;
    const tick = async () => {
      if (!active) return;
      if (!document.hidden) await run();
      if (active) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [run, intervalMs]);

  return { data, error, loading, refresh: run };
}
