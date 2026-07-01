import { describe, it, expect } from "vitest";
import { fmtRelative, fmtUptime, fmtMs, fmtPct, severityTone } from "./format";

describe("fmtRelative", () => {
  it("handles seconds/minutes/hours and bad input", () => {
    expect(fmtRelative(new Date(Date.now() - 5000).toISOString())).toMatch(/\ds ago/);
    expect(fmtRelative(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(fmtRelative(new Date(Date.now() - 3 * 3_600_000).toISOString())).toBe("3h ago");
    expect(fmtRelative(null)).toBe("—");
    expect(fmtRelative("not-a-date")).toBe("—");
  });
});

describe("fmtUptime", () => {
  it("formats by the largest unit", () => {
    expect(fmtUptime(45)).toBe("45s");
    expect(fmtUptime(90)).toBe("1m 30s");
    expect(fmtUptime(3700)).toBe("1h 1m");
    expect(fmtUptime(90000)).toBe("1d 1h");
    expect(fmtUptime(null)).toBe("—");
  });
});

describe("fmtMs / fmtPct", () => {
  it("scales milliseconds to seconds past 1000", () => {
    expect(fmtMs(0.5)).toBe("0.50 ms");
    expect(fmtMs(12.34)).toBe("12.3 ms");
    expect(fmtMs(2500)).toBe("2.50 s");
    expect(fmtMs(null)).toBe("—");
  });

  it("renders a fraction as a percentage", () => {
    expect(fmtPct(0)).toBe("0.00%");
    expect(fmtPct(0.1234)).toBe("12.34%");
    expect(fmtPct(null)).toBe("—");
  });
});

describe("severityTone", () => {
  it("maps log severities to tones", () => {
    expect(severityTone("error")).toBe("down");
    expect(severityTone("CRITICAL")).toBe("down");
    expect(severityTone("warning")).toBe("degraded");
    expect(severityTone("info")).toBe("neutral");
    expect(severityTone(undefined)).toBe("neutral");
  });
});
