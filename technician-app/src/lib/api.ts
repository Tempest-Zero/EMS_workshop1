/**
 * Typed FastAPI client. One file per backend slice we consume; today only
 * `media`. Generated types from OpenAPI is a later upgrade — for one slice
 * hand-typed is clearer.
 */

import { config } from "./config";
import { getToken, setToken } from "./auth";

// before/after = repair evidence; condition = arrival condition snaps;
// remark/intake/approval = the completion / problem / estimate voice notes;
// closing = the required closing video. Mirrors the backend's 0036 set.
export type Phase =
  | "before"
  | "after"
  | "remark"
  | "closing"
  | "condition"
  | "approval"
  | "intake";
export type MediaType = "video" | "photo" | "audio";
export type MediaStatus = "pending" | "uploaded";

export interface MediaItem {
  id: string;
  job_id: string;
  phase: Phase;
  type: MediaType;
  filename: string;
  storage_path: string;
  content_type: string | null;
  size_bytes: number | null;
  status: MediaStatus;
  created_at: string;
  uploaded_at: string | null;
  playback_url: string | null;
}

export interface MediaList {
  before: MediaItem[];
  after: MediaItem[];
  closing: MediaItem[];
  condition: MediaItem[];
}

export interface MediaUploadResponse {
  media_id: string;
  signed_url: string;
  storage_path: string;
  expires_in: number;
}

export interface MediaUploadRequest {
  phase: Phase;
  type: MediaType;
  filename: string;
  content_type?: string;
}

let onUnauthorized: (() => void) | null = null;
/** Register a callback fired when any request 401s (token already cleared). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

/**
 * An HTTP-level failure with its status attached. The outbox classifies on
 * `status` (definitive 4xx → visible failed list; 5xx/429 → retry), so this
 * must stay the ONLY error shape `request()` throws for non-OK responses —
 * string-matching on messages is what caused the v1 silent-drop bug.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(method: string, path: string, status: number, bodyText: string) {
    super(`${method} ${path} failed (${status}): ${bodyText.slice(0, 300)}`);
    this.name = "ApiError";
    this.status = status;
  }
}

// JSON API calls are bounded so a hung request on flaky workshop wifi can't pin
// the UI in a loading state forever. (Media/selfie BYTE uploads go through
// FileSystem.uploadAsync, not this path, so big uploads aren't affected.)
const REQUEST_TIMEOUT_MS = 15_000;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch (e) {
    const method = init?.method ?? "GET";
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401) {
    await setToken(null);
    onUnauthorized?.();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const method = init?.method ?? "GET";
    throw new ApiError(method, path, response.status, text);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  requestUpload: (jobId: string, body: MediaUploadRequest) =>
    request<MediaUploadResponse>(`/api/jobs/${encodeURIComponent(jobId)}/media`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  completeUpload: (jobId: string, mediaId: string, body: { size_bytes?: number }) =>
    request<MediaItem>(
      `/api/jobs/${encodeURIComponent(jobId)}/media/${encodeURIComponent(mediaId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  listMedia: (jobId: string) =>
    request<MediaList>(`/api/jobs/${encodeURIComponent(jobId)}/media`),

  deleteMedia: (jobId: string, mediaId: string) =>
    request<void>(
      `/api/jobs/${encodeURIComponent(jobId)}/media/${encodeURIComponent(mediaId)}`,
      { method: "DELETE" },
    ),
};
