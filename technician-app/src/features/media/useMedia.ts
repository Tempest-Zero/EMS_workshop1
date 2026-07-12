/**
 * React state for READING a job's media list (the hub's evidence strip).
 * Uploads don't live here: the wizard and completion form call `uploadMedia`
 * directly, and deletes ride the wizard's own capture UI — so this hook owns
 * only the list, its loading/error flags, and refresh.
 */

import { useCallback, useEffect, useState } from "react";

import { api, type MediaList } from "../../lib/api";

const EMPTY: MediaList = { before: [], after: [], closing: [], condition: [] };

export interface UseMediaState {
  list: MediaList;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useMedia(jobId: string): UseMediaState {
  const [list, setList] = useState<MediaList>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setList(await api.listMedia(jobId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { list, loading, error, refresh };
}
