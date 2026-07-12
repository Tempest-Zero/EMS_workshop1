/**
 * The closing-video gate, shared by the bill sheet (the new-UI close, F16)
 * and the job-detail fallback. Records the clip, uploads it (phase=closing,
 * keyed on the token — capturing reserves a media row, so even a slow upload
 * satisfies the server's close gate), then transitions to close.
 *
 * Two-stage on purpose: if the bytes never land the close is not attempted
 * and the message names the real upload problem; once the video IS saved, a
 * close failure must never send the tech back to re-record an orphan clip.
 */

import * as ImagePicker from "expo-image-picker";

import { ApiError } from "../../lib/api";
import { jobsApi, type JobDetail } from "../../lib/jobsApi";
import { uploadMedia } from "../media/uploadMedia";

export type CloseWithVideoResult =
  | { kind: "closed"; job: JobDetail }
  | { kind: "canceled" }
  | { kind: "no-permission"; message: string }
  | { kind: "upload-failed"; message: string }
  | { kind: "close-failed"; message: string };

/** The server's human-readable rejection (FastAPI `detail`), if present. */
function apiDetail(e: ApiError): string | null {
  return /"detail"\s*:\s*"([^"]+)"/.exec(e.message)?.[1] ?? null;
}

export async function closeJobWithVideo(id: string, token: number): Promise<CloseWithVideoResult> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    return {
      kind: "no-permission",
      message: "Camera permission is needed to record the closing video.",
    };
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    quality: 0.85,
    videoMaxDuration: 60,
  });
  if (result.canceled || result.assets.length === 0) return { kind: "canceled" };
  const asset = result.assets[0];
  if (!asset) return { kind: "canceled" };

  try {
    await uploadMedia({
      jobId: String(token),
      phase: "closing",
      type: "video",
      uri: asset.uri,
      filename: asset.fileName ?? `closing-${Date.now()}.mp4`,
      contentType: asset.mimeType ?? "video/mp4",
    });
  } catch (e) {
    console.warn("close+video upload failed", e);
    if (e instanceof ApiError && e.status === 413) {
      return {
        kind: "upload-failed",
        message: "The closing video is too large to upload — try a shorter clip.",
      };
    }
    if (e instanceof ApiError) {
      return {
        kind: "upload-failed",
        message: apiDetail(e) ?? "Couldn't upload the closing video — try again.",
      };
    }
    return {
      kind: "upload-failed",
      message: "Couldn't upload the closing video — check your connection and try again.",
    };
  }

  try {
    return { kind: "closed", job: await jobsApi.transition(id, "close") };
  } catch (e) {
    console.warn("close+video close failed", e);
    if (e instanceof ApiError && (e.status === 409 || e.status === 400)) {
      const detail = apiDetail(e) ?? "try again after syncing.";
      return {
        kind: "close-failed",
        message: `Video saved, but the job can't be closed yet: ${detail}`,
      };
    }
    return {
      kind: "close-failed",
      message: "The closing video uploaded, but the job couldn't be closed — try again.",
    };
  }
}
