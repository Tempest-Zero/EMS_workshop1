import { describe, it, expect } from "vitest";
import { estimateTotal, amountOwed, balance, hasEstimate } from "@shared/lib/job";

const job = {
  estimate: {
    status: "approved",
    parts: [{ name: "Run capacitor 35µF", qty: 2, unitPrice: 800 }],
    laborHours: 1.5,
    laborRate: 1200,
  },
  payment: { paid: 1000 },
};

describe("job estimate math", () => {
  it("sums parts (qty × unitPrice) plus labor (hours × rate)", () => {
    // 2 × 800 = 1600 parts, 1.5 × 1200 = 1800 labor
    expect(estimateTotal(job.estimate)).toBe(3400);
  });

  it("amountOwed reflects the estimate total when an estimate exists", () => {
    expect(amountOwed(job)).toBe(3400);
  });

  it("balance subtracts what has been paid", () => {
    expect(balance(job)).toBe(2400);
  });

  it("hasEstimate is false before an estimate is set", () => {
    expect(hasEstimate({ estimate: { status: "none" } })).toBe(false);
  });
});
