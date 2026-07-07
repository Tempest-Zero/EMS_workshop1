/**
 * The end-to-end upload pipeline. Pure async function (no React); easy to
 * unit-test by mocking `api`, `FileSystem`, and `compressVideo`.
 *
 *   1. Compress (videos only).
 *   2. POST  /api/jobs/{id}/media           → backend mints a signed R2 URL.
 *   3. PUT  signed URL                       → bytes go DIRECT to R2 storage
 *                                              (FastAPI never sees them).
 *   4. POST /api/jobs/{id}/media/{m}/complete → backend flips status to uploaded
 *                                               and returns a signed playback URL.
 *
 * Returns the finalized `MediaItem` so the UI can render it immediately
 * without a separate list refresh.
 */

import * as FileSystem from "expo-file-system";

import { api, type MediaItem, type MediaType, type Phase } from "../../lib/api";
import { compressVideo } from "../../lib/compress";

export interface UploadInput {
  jobId: string;
  phase: Phase;
  type: MediaType;
  /** Local file URI from expo-image-picker (e.g. `file:///path/clip.mp4`). */
  uri: string;
  /** Original filename — kept for display + to derive the extension. */
  filename: string;
  contentType: string;
}

export async function uploadMedia(input: UploadInput): Promise<MediaItem> {
  const localUri = input.type === "video" ? await compressVideo(input.uri) : input.uri;

  const reservation = await api.requestUpload(input.jobId, {
    phase: input.phase,
    type: input.type,
    filename: input.filename,
    content_type: input.contentType,
  });

  const upload = await FileSystem.uploadAsync(reservation.signed_url, localUri, {
    httpMethod: "PUT",
    headers: { "Content-Type": input.contentType },
  });
  if (upload.status >= 400) {
    throw new Error(
      `Upload to storage failed (${upload.status}): ${upload.body.slice(0, 200)}`,
    );
  }

  const info = await FileSystem.getInfoAsync(localUri, { size: true });
  const sizeBytes = info.exists && "size" in info ? info.size : undefined;

  return api.completeUpload(input.jobId, reservation.media_id, {
    size_bytes: sizeBytes,
  });
}
