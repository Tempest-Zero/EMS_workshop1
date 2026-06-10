import { describe, it, expect } from "vitest";
import {
  amountOwed,
  amountPaid,
  balance,
  billOriginal,
  billPayable,
  billDiscount,
  isNegotiated,
  hasBill,
  revenueEntries,
  materialsTotal,
  completionLabor,
  completionTotal,
  hasCompletion,
  isUnassigned,
} from "@shared/lib/job";

describe("billing — original vs negotiated", () => {
  const base = { bill: { original: 5000, negotiated: null, status: "generated" } };

  it("billOriginal reads the server bill; no bill means zero (no client fallback)", () => {
    expect(billOriginal(base)).toBe(5000);
    expect(hasBill(base)).toBe(true);
    expect(billOriginal({})).toBe(0);
    expect(hasBill({})).toBe(false);
    expect(billOriginal({ bill: { original: null, negotiated: null } })).toBe(0);
  });

  it("billPayable uses the negotiated amount when one is logged", () => {
    const j = { bill: { original: 5000, negotiated: 4200, status: "negotiated" } };
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

  it("no ledger means nothing paid — there is no client-side fallback", () => {
    expect(amountPaid({})).toBe(0);
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

describe("work completion → bill", () => {
  const completion = {
    materials: [
      { name: "Relay", qty: 2, unitPrice: 600 }, // 1200
      { name: "Gas top-up", qty: 1, unitPrice: 1500 }, // 1500
    ],
    timeSpentMins: 90, // 1.5h × 1200 = 1800 labour
    fuelAmount: 500,
    submittedAt: "2026-06-07T12:00:00Z",
  };

  it("materialsTotal sums qty × unitPrice", () => {
    expect(materialsTotal(completion)).toBe(2700);
  });

  it("completionLabor converts minutes to labour at the rate", () => {
    expect(completionLabor(completion, 1200)).toBe(1800);
  });

  it("completionTotal = materials + labour + fuel", () => {
    // 2700 + 1800 + 500
    expect(completionTotal(completion, 1200)).toBe(5000);
  });

  it("hasCompletion reflects a submitted form", () => {
    expect(hasCompletion({ completion })).toBe(true);
    expect(hasCompletion({ completion: null })).toBe(false);
    expect(hasCompletion({})).toBe(false);
  });
});

describe("assignment", () => {
  it("isUnassigned is true with no technician", () => {
    expect(isUnassigned({ assignedTechId: null })).toBe(true);
    expect(isUnassigned({ assignedTechId: "" })).toBe(true);
    expect(isUnassigned({})).toBe(true);
    expect(isUnassigned({ assignedTechId: "t3" })).toBe(false);
  });
});
