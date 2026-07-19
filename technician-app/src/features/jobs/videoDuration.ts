/**
 * Duration gate for job-evidence videos. Android camera apps frequently
 * ignore ImagePicker's `videoMaxDuration` (a clip can run long) and no
 * minimum exists at all (a 1-second "video" passes the evidence gates), so
 * the picker result is checked here BEFORE the clip reaches the draft or
 * any upload path.
 *
 * Fail-open on an unknown duration: this is a UX guard, not a security
 * control — some pickers omit `duration`, and probing the file with
 * expo-av just to reject it isn't worth the flakiness.
 */

export type VideoDurationVerdict = "ok" | "too_short" | "too_long" | "unknown";

/** `durationMs` is the picker asset's duration in MILLISECONDS (may be absent). */
export function checkVideoDuration(
  durationMs: number | null | undefined,
  limits: { minMs: number; maxMs: number },
): VideoDurationVerdict {
  if (durationMs == null || Number.isNaN(durationMs) || durationMs <= 0) return "unknown";
  if (durationMs < limits.minMs) return "too_short";
  if (durationMs > limits.maxMs) return "too_long";
  return "ok";
}
