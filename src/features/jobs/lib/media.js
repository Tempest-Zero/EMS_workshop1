// Before/after media is the technician's SOP proof of work.
//
// Home-appliance faults are usually functional/internal (a compressor, PCB,
// gas charge or motor) — the unit looks identical before and after, so a still
// photo proves nothing. A short VIDEO does (running faulty vs. running fixed).
// Hence a before AND after video are REQUIRED to mark a job Ready; photos are
// allowed as optional extras but do not satisfy the check.

export function jobMedia(job, phase) {
  return job?.media?.[phase] ?? [];
}

export function hasVideo(job, phase) {
  return jobMedia(job, phase).some((m) => m.type === "video");
}

export function anyMedia(job) {
  return jobMedia(job, "before").length + jobMedia(job, "after").length > 0;
}

// Human-readable list of what's still missing to mark Ready (empty = satisfied).
export function missingReadyMedia(job) {
  const missing = [];
  if (!hasVideo(job, "before")) missing.push("a Before video");
  if (!hasVideo(job, "after")) missing.push("an After video");
  return missing;
}

export function canMarkReady(job) {
  return missingReadyMedia(job).length === 0;
}
