import { describe, it, expect } from "vitest";
import { formatPKR } from "@shared/lib/currency";

describe("formatPKR", () => {
  it("prefixes amounts with 'Rs ' and groups thousands", () => {
    expect(formatPKR(4500)).toBe("Rs 4,500");
  });

  it("rounds fractional amounts", () => {
    expect(formatPKR(1199.6)).toBe("Rs 1,200");
  });

  it("falls back to 'Rs 0' for null / NaN", () => {
    expect(formatPKR(null)).toBe("Rs 0");
    expect(formatPKR(NaN)).toBe("Rs 0");
  });
});
