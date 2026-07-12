import { createJobPayload, estimateRupees, type CreateJobDraft } from "./createJobPayload";

const DRAFT: CreateJobDraft = {
  phone: "0312 6677889",
  name: "  Yusuf Khan  ",
  appliance: "Refrigerator",
  brand: "Haier",
  problemText: "Not cooling",
  hasProblemAudio: false,
  location: "House 31, DHA Phase 2",
  serviceType: "Home visit",
  timeWindow: "Today 4-6",
  estimate: "",
  approval: "Approve now",
  consent: true,
  customerLat: 24.8607,
  customerLng: 67.0011,
  categoryId: "refrigerator",
  intakeChannel: "walk_in",
  techId: "t3",
};

describe("createJobPayload", () => {
  it("maps a home visit with pin, address, schedule and self-assignment", () => {
    const body = createJobPayload(DRAFT, "cid-1");
    expect(body).toMatchObject({
      client_id: "cid-1",
      job_type: "home-visit",
      customer_name: "Yusuf Khan",
      customer_address: "House 31, DHA Phase 2",
      customer_lat: 24.8607,
      customer_lng: 67.0011,
      appliance_type: "Refrigerator",
      appliance_brand: "Haier",
      problem: "Not cooling",
      assigned_tech_id: "t3",
      time_window: "Today 4-6",
      intake_channel: "walk_in",
      whatsapp_consent: true,
    });
  });

  it("drops the visit-only fields (address, pin, window) for a carry-in", () => {
    const body = createJobPayload({ ...DRAFT, serviceType: "Carry-in" }, "cid-2");
    expect(body.job_type).toBe("carry-in");
    expect(body.customer_address).toBeNull();
    expect(body.customer_lat).toBeNull();
    expect(body.customer_lng).toBeNull();
    expect(body.time_window).toBeNull();
  });

  it("maps Pickup to pickup-delivery and keeps the visit fields", () => {
    const body = createJobPayload({ ...DRAFT, serviceType: "Pickup" }, "cid-3");
    expect(body.job_type).toBe("pickup-delivery");
    expect(body.customer_address).toBe("House 31, DHA Phase 2");
  });

  it("appends the estimate as a labelled problem suffix (no Job column yet)", () => {
    const body = createJobPayload(
      { ...DRAFT, estimate: "Rs 3,500", approval: "Customer review" },
      "cid-4",
    );
    expect(body.problem).toBe("Not cooling\n\n[Estimate Rs 3,500 · Customer review]");
  });

  it("stands in placeholder text when the problem is voice-only", () => {
    const body = createJobPayload(
      { ...DRAFT, problemText: "", hasProblemAudio: true },
      "cid-5",
    );
    expect(body.problem).toBe("(voice note attached)");
  });

  it("passes the resolved catalog category id through", () => {
    expect(createJobPayload(DRAFT, "cid-6").category_id).toBe("refrigerator");
    // Hardcoded-fallback pick → no id (server text-matches).
    expect(createJobPayload({ ...DRAFT, categoryId: null }, "cid-7").category_id).toBeNull();
  });

  it("carries the selected intake channel", () => {
    expect(createJobPayload({ ...DRAFT, intakeChannel: "whatsapp" }, "cid-8").intake_channel).toBe(
      "whatsapp",
    );
  });
});

describe("estimateRupees", () => {
  it.each([
    ["3500", 3500],
    ["Rs 3,500", 3500],
    ["", 0],
    ["abc", 0],
  ])("parses %p → %p", (text, expected) => {
    expect(estimateRupees(text)).toBe(expected);
  });
});
