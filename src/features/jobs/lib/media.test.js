import { describe, it, expect } from "vitest";
import { hasVideo, anyMedia, missingReadyMedia, canMarkReady } from "@features/jobs/lib/media";

const vid = { id: "1", type: "video", url: "blob:v" };
const pic = { id: "2", type: "photo", url: "blob:p" };

describe("job media SOP gate", () => {
  it("treats a job with no media as missing both videos", () => {
    const job = {};
    expect(missingReadyMedia(job)).toEqual(["a Before video", "an After video"]);
    expect(canMarkReady(job)).toBe(false);
    expect(anyMedia(job)).toBe(false);
  });

  it("photos alone do NOT satisfy the gate (functional repairs need video)", () => {
    const job = { media: { before: [pic], after: [pic] } };
    expect(canMarkReady(job)).toBe(false);
    expect(missingReadyMedia(job)).toHaveLength(2);
    expect(anyMedia(job)).toBe(true);
  });

  it("requires BOTH a before and an after video", () => {
    const job = { media: { before: [vid], after: [] } };
    expect(missingReadyMedia(job)).toEqual(["an After video"]);
    expect(canMarkReady(job)).toBe(false);
  });

  it("passes once a before AND after video exist", () => {
    const job = { media: { before: [vid], after: [vid, pic] } };
    expect(missingReadyMedia(job)).toEqual([]);
    expect(canMarkReady(job)).toBe(true);
    expect(hasVideo(job, "before")).toBe(true);
    expect(hasVideo(job, "after")).toBe(true);
  });
});
