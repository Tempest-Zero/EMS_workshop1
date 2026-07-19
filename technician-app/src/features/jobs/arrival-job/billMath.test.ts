import { defaultPayRs, isNegotiateDirty } from "./billMath";

describe("defaultPayRs", () => {
  it("is empty when nothing is owed", () => {
    expect(defaultPayRs(0)).toBe("");
  });

  it("is empty for a negative balance (overpaid)", () => {
    expect(defaultPayRs(-5_000)).toBe("");
  });

  it("converts paisa to whole rupees", () => {
    expect(defaultPayRs(450_000)).toBe("4500");
  });

  it("rounds a half-rupee remainder", () => {
    expect(defaultPayRs(450_050)).toBe("4501");
  });
});

describe("isNegotiateDirty", () => {
  it("an empty/zero input is never dirty", () => {
    expect(isNegotiateDirty(0, null, 450_000)).toBe(false);
  });

  it("matching the stored negotiated amount is clean", () => {
    expect(isNegotiateDirty(400_000, 400_000, 450_000)).toBe(false);
  });

  it("matching the original when nothing was negotiated is clean", () => {
    expect(isNegotiateDirty(450_000, null, 450_000)).toBe(false);
  });

  it("an amount the server doesn't hold is dirty", () => {
    expect(isNegotiateDirty(400_000, null, 450_000)).toBe(true);
    expect(isNegotiateDirty(380_000, 400_000, 450_000)).toBe(true);
  });
});
