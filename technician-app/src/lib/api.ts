/**
 * Typed FastAPI client. One file per backend slice we consume; today only
 * `media`. Generated types from OpenAPI is a later upgrade — for one slice
 * hand-typed is clearer.
 */

import { config } from "./config";
import { getToken, setToken } from "./auth";

export type Phase = "before" | "after" | "remark" | "closing";
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 401) {
    await setToken(null);
    onUnauthorized?.();
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const method = init?.method ?? "GET";
    throw new Error(`${method} ${path} failed (${response.status}): ${text.slice(0, 300)}`);
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
