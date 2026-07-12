/**
 * Per-job draft of the arrival wizard. Captured evidence URIs and picked
 * codes survive process death — a killed app must never cost re-shot
 * photos or a re-recorded voice note. Cleared when the completion submits.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { createMutex } from "../../../lib/mutex";

export interface MaterialLine {
  name: string;
  qty: number;
  unit_paisa: number;
}

/** Upload lifecycle per captured item, keyed by capture slot. */
export type UploadState = "idle" | "uploading" | "done" | "queued" | "failed";

export interface ArrivalDraft {
  step: number;
  serialUri: string | null;
  conditionUris: string[];
  errorCodeStatus: "pending" | "no" | "yes_pending" | "done";
  errorCodeUri: string | null;
  videoUri: string | null;
  /** The AFTER-video (F10) — the work-done gate before outcome & time. */
  afterVideoUri: string | null;
  voiceUri: string | null;
  /** Server id of the uploaded remark voice note (links into the completion). */
  remarkMediaId: string | null;
  faultId: string | null;
  actionId: string | null;
  materials: MaterialLine[];
  /** Which capture slots already reached the server (or its queue). */
  uploads: Record<string, UploadState>;
  /** Epoch ms the on-site clock started (arrival). Persisted so the step-5
   * stopwatch survives a killed/reopened wizard instead of resetting to now.
   * Set once by the wizard; null until then. */
  arrivalAtMs: number | null;
}

export const EMPTY_DRAFT: ArrivalDraft = {
  step: 1,
  serialUri: null,
  conditionUris: [],
  errorCodeStatus: "pending",
  errorCodeUri: null,
  videoUri: null,
  afterVideoUri: null,
  voiceUri: null,
  remarkMediaId: null,
  faultId: null,
  actionId: null,
  materials: [],
  uploads: {},
  arrivalAtMs: null,
};

const keyFor = (jobId: string) => `jobs.arrivalDraft.v1:${jobId}`;
const mutex = createMutex();

export async function loadArrivalDraft(jobId: string): Promise<ArrivalDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(jobId));
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<ArrivalDraft>) } : null;
  } catch {
    return null;
  }
}

export async function saveArrivalDraft(jobId: string, draft: ArrivalDraft): Promise<void> {
  await mutex(async () => {
    await AsyncStorage.setItem(keyFor(jobId), JSON.stringify(draft));
  });
}

export async function clearArrivalDraft(jobId: string): Promise<void> {
  await mutex(async () => {
    await AsyncStorage.removeItem(keyFor(jobId));
  });
}
