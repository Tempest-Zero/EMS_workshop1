// arrivalDraft touches AsyncStorage at import time — stub the native module.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

import { EMPTY_DRAFT, type ArrivalDraft } from "./arrivalDraft";
import { completionFromWizard } from "./completionFromWizard";

const DRAFT: ArrivalDraft = {
  ...EMPTY_DRAFT,
  voiceUri: "file:///tmp/summary.m4a",
  remarkMediaId: "media-1",
  faultId: "ac_gas_low",
  actionId: "ac_gas_recharge",
  materials: [
    { name: "R-134a gas", qty: 1, unit_paisa: 180_000 },
    { name: "", qty: 1, unit_paisa: 100 }, // nameless → dropped
    { name: "Copper pipe /ft", qty: 0, unit_paisa: 35_000 }, // zero qty → dropped
  ],
};

it("maps materials, codes, remark audio and the outcome", () => {
  const body = completionFromWizard(DRAFT, {
    outcome: "Repaired",
    timeSpentMins: 47.6,
    adjustReason: null,
  });
  expect(body.materials).toEqual([{ name: "R-134a gas", qty: 1, unit_paisa: 180_000 }]);
  expect(body.time_spent_mins).toBe(48); // rounded
  expect(body.remarks_text).toBe("Outcome: Repaired");
  expect(body.remarks_audio_media_id).toBe("media-1");
  expect(body.fault_code_id).toBe("ac_gas_low");
  expect(body.action_code_id).toBe("ac_gas_recharge");
});

it("OMITS fuel entirely — the server derives round-trip fuel (0035)", () => {
  const body = completionFromWizard(DRAFT, {
    outcome: "Repaired",
    timeSpentMins: 30,
    adjustReason: null,
  });
  expect("fuel_paisa" in body).toBe(false);
});

it("records the time-adjustment reason in the remarks", () => {
  const body = completionFromWizard(DRAFT, {
    outcome: "Needs part",
    timeSpentMins: 90,
    adjustReason: "waited for the customer to return",
  });
  expect(body.remarks_text).toBe(
    "Outcome: Needs part · Time adjusted — waited for the customer to return",
  );
});

it("flags a voice note that hasn't uploaded yet", () => {
  const body = completionFromWizard(
    { ...DRAFT, remarkMediaId: null },
    { outcome: "Repaired", timeSpentMins: 30, adjustReason: null },
  );
  expect(body.remarks_text).toContain("[voice summary pending upload]");
  expect("remarks_audio_media_id" in body).toBe(false);
});

it("never sends codes that didn't come from the catalog", () => {
  const body = completionFromWizard(
    { ...DRAFT, faultId: null, actionId: null },
    { outcome: "Repaired", timeSpentMins: 30, adjustReason: null },
  );
  expect("fault_code_id" in body).toBe(false);
  expect("action_code_id" in body).toBe(false);
});
