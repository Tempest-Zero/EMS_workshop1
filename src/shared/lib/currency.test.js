import { describe, it, expect } from "vitest";
import { formatPKR, rupeesToPaisa, paisaToRupees } from "@shared/lib/currency";

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

describe("rupeesToPaisa", () => {
  it("multiplies whole rupees to integer paisa", () => {
    expect(rupeesToPaisa(4500)).toBe(450000);
    expect(rupeesToPaisa("1200")).toBe(120000);
  });

  it("rounds to the nearest paisa and handles junk as 0", () => {
    expect(rupeesToPaisa(12.345)).toBe(1235);
    expect(rupeesToPaisa("")).toBe(0);
    expect(rupeesToPaisa(undefined)).toBe(0);
  });
});

describe("paisaToRupees", () => {
  it("divides integer paisa down to rupees", () => {
    expect(paisaToRupees(450000)).toBe(4500);
    expect(paisaToRupees(120000)).toBe(1200);
  });

  it("passes null/undefined through (so 'no bill' ≠ 'Rs 0')", () => {
    expect(paisaToRupees(null)).toBeNull();
    expect(paisaToRupees(undefined)).toBeNull();
  });

  it("round-trips with rupeesToPaisa", () => {
    expect(paisaToRupees(rupeesToPaisa(3400))).toBe(3400);
  });
});
