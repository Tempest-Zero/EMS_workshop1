/**
 * The evidence-video duration gate: exact bounds are inclusive, out-of-bounds
 * clips are named, and a missing/garbage duration fails OPEN ("unknown") —
 * it's a UX guard, not a security control.
 */

import { checkVideoDuration } from "./videoDuration";

const LIMITS = { minMs: 3_000, maxMs: 20_000 };

it("exactly the minimum is ok — the bound is inclusive", () => {
  expect(checkVideoDuration(3_000, LIMITS)).toBe("ok");
});

it("exactly the maximum is ok — the bound is inclusive", () => {
  expect(checkVideoDuration(20_000, LIMITS)).toBe("ok");
});

it("one ms under the minimum is too_short", () => {
  expect(checkVideoDuration(2_999, LIMITS)).toBe("too_short");
});

it("one ms over the maximum is too_long", () => {
  expect(checkVideoDuration(20_001, LIMITS)).toBe("too_long");
});

it("the owner's reported bug — a 1-second clip against a 3s minimum — is too_short", () => {
  expect(checkVideoDuration(1_000, LIMITS)).toBe("too_short");
});

it("fails open on a missing or garbage duration", () => {
  expect(checkVideoDuration(null, LIMITS)).toBe("unknown");
  expect(checkVideoDuration(undefined, LIMITS)).toBe("unknown");
  expect(checkVideoDuration(0, LIMITS)).toBe("unknown");
  expect(checkVideoDuration(NaN, LIMITS)).toBe("unknown");
  expect(checkVideoDuration(-1, LIMITS)).toBe("unknown");
});
