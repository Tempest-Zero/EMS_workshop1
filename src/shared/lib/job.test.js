import { describe, it, expect } from "vitest";
import {
  estimateTotal,
  amountOwed,
  amountPaid,
  balance,
  hasEstimate,
  billOriginal,
  billPayable,
  billDiscount,
  isNegotiated,
  hasBill,
  revenueEntries,
} from "@shared/lib/job";

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

describe("billing — original vs negotiated", () => {
  // original = 1 × 5000 = 5000
  const base = {
    estimate: {
      status: "approved",
      parts: [{ name: "Compressor", qty: 1, unitPrice: 5000 }],
      laborHours: 0,
      laborRate: 1200,
    },
  };

  it("billOriginal falls back to the estimate total", () => {
    expect(billOriginal(base)).toBe(5000);
    expect(hasBill(base)).toBe(true);
  });

  it("billPayable uses the negotiated amount when one is logged", () => {
    const j = { ...base, bill: { original: 5000, negotiated: 4200, status: "negotiated" } };
    expect(isNegotiated(j)).toBe(true);
    expect(billPayable(j)).toBe(4200);
    expect(billDiscount(j)).toBe(800);
    expect(amountOwed(j)).toBe(4200); // owed tracks the negotiated figure
  });

  it("payable equals original when not negotiated", () => {
    expect(isNegotiated(base)).toBe(false);
    expect(billPayable(base)).toBe(5000);
    expect(billDiscount(base)).toBe(0);
  });
});

describe("revenue ledger", () => {
  it("amountPaid sums only non-voided entries", () => {
    const j = {
      revenue: [
        { id: "a", amount: 1000, voided: false },
        { id: "b", amount: 500, voided: true }, // a correction — excluded
        { id: "c", amount: 2000, voided: false },
      ],
    };
    expect(amountPaid(j)).toBe(3000);
  });

  it("falls back to payment.paid when there is no ledger", () => {
    expect(amountPaid({ payment: { paid: 750 } })).toBe(750);
    expect(revenueEntries({})).toEqual([]);
  });

  it("balance = payable − received", () => {
    const j = {
      bill: { original: 5000, negotiated: 4200 },
      revenue: [{ id: "a", amount: 4200, voided: false }],
    };
    expect(balance(j)).toBe(0);
  });
});
