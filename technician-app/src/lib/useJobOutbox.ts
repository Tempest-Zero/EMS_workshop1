/**
 * Live view of the outbox for ONE job — the data source for the Job Detail
 * pending overlay. The screen renders server truth + these queued/failed items
 * so the technician always sees what they recorded, including writes that
 * haven't reached the server yet. (This visibility — not idempotency — is what
 * prevents offline double-charging: each tap mints a fresh client_id, so only
 * the UI can tell a doubting technician "you already logged that".)
 */

import { useCallback, useEffect, useState } from "react";

import { itemsForJob, onOutboxChange, type OutboxItem } from "./outbox";

export interface JobOutboxView {
  queued: OutboxItem[];
  failed: OutboxItem[];
}

export function useJobOutbox(jobId: string): JobOutboxView {
  const [view, setView] = useState<JobOutboxView>({ queued: [], failed: [] });

  const refresh = useCallback(async () => {
    const items = await itemsForJob(jobId);
    setView({
      queued: items.filter((i) => i.status === "queued"),
      failed: items.filter((i) => i.status === "failed"),
    });
  }, [jobId]);

  useEffect(() => {
    void refresh();
    return onOutboxChange(() => void refresh());
  }, [refresh]);

  return view;
}
