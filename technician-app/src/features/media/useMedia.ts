/**
 * React state for the media slice. Owns the list, loading/error/uploading
 * flags, and the three actions the UI invokes.
 */

import { useCallback, useEffect, useState } from "react";

import { api, type MediaList, type MediaType, type Phase } from "../../lib/api";
import { uploadMedia } from "./uploadMedia";

const EMPTY: MediaList = { before: [], after: [], closing: [], condition: [] };

export interface UseMediaState {
  list: MediaList;
  loading: boolean;
  error: string | null;
  uploadingPhase: Phase | null;
  refresh: () => Promise<void>;
  upload: (params: {
    phase: Phase;
    type: MediaType;
    uri: string;
    filename: string;
    contentType: string;
  }) => Promise<void>;
  remove: (mediaId: string) => Promise<void>;
}

export function useMedia(jobId: string): UseMediaState {
  const [list, setList] = useState<MediaList>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPhase, setUploadingPhase] = useState<Phase | null>(null);

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

  const upload = useCallback(
    async (params: {
      phase: Phase;
      type: MediaType;
      uri: string;
      filename: string;
      contentType: string;
    }) => {
      setUploadingPhase(params.phase);
      setError(null);
      try {
        await uploadMedia({ jobId, ...params });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setUploadingPhase(null);
      }
    },
    [jobId, refresh],
  );

  const remove = useCallback(
    async (mediaId: string) => {
      setError(null);
      try {
        await api.deleteMedia(jobId, mediaId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [jobId, refresh],
  );

  return { list, loading, error, uploadingPhase, refresh, upload, remove };
}
