import { describe, it, expect } from "vitest";
import { mapApiJob, toCreateBody } from "./mapJob";

describe("mapApiJob", () => {
  it("maps snake_case API fields to the nested view shape", () => {
    const job = mapApiJob({
      id: "uuid-1",
      token: 1042,
      status: "waiting",
      job_type: "home-visit",
      customer_name: "Hina Tariq",
      customer_phone: "0345-7654321",
      customer_address: "House 22, KDA Scheme 1",
      appliance_type: "Refrigerator",
      appliance_brand: "Haier",
      appliance_model: "HRF-368",
      problem: "No cooling",
      assigned_tech_id: "t4",
      created_at: "2026-05-22T10:00:00Z",
      waiting_since: "2026-05-25",
      waiting_reason: "Awaiting customer approval",
      preferred_date: "2026-05-23",
      time_window: "3:00 PM – 4:00 PM",
      abandoned: false,
    });

    expect(job.id).toBe("uuid-1");
    expect(job.token).toBe(1042);
    expect(job.jobType).toBe("home-visit");
    expect(job.customer).toEqual({
      name: "Hina Tariq",
      phone: "0345-7654321",
      address: "House 22, KDA Scheme 1",
    });
    expect(job.appliance.type).toBe("Refrigerator");
    expect(job.createdAt).toBe("2026-05-22"); // date-only
    expect(job.waitingReason).toBe("Awaiting customer approval");
    expect(job.notes).toEqual([]);
    expect(job.timeline).toEqual([]);
    // No bill/completion/ledger on the wire → empty (null amounts, not Rs 0).
    expect(job.bill).toEqual({ original: null, negotiated: null, status: "none" });
    expect(job.completion).toBeNull();
    expect(job.revenue).toEqual([]);
  });

  it("maps the bill, completion and ledger from paisa to rupees (P2f)", () => {
    const job = mapApiJob({
      id: "u",
      token: 1,
      status: "ready",
      job_type: "carry-in",
      customer_name: "A",
      appliance_type: "AC",
      problem: "",
      abandoned: false,
      bill_original_paisa: 500000,
      bill_negotiated_paisa: 420000,
      bill_status: "negotiated",
      completion: {
        time_spent_mins: 90,
        fuel_paisa: 50000,
        remarks_text: "regassed",
        submitted_at: "2026-06-07T12:00:00Z",
        materials: [{ name: "Relay", qty: 2, unit_paisa: 60000 }],
      },
      payments: [
        {
          id: "p1",
          amount_paisa: 420000,
          method: "cash",
          voided: false,
          void_reason: null,
          recorded_at: "2026-06-07T12:05:00Z",
        },
        {
          id: "p2",
          amount_paisa: 100000,
          method: "card",
          voided: true,
          void_reason: "duplicate",
          recorded_at: "2026-06-07T12:06:00Z",
        },
      ],
      received_paisa: 420000,
      balance_paisa: 0,
    });

    expect(job.bill).toEqual({ original: 5000, negotiated: 4200, status: "negotiated" });
    expect(job.completion.timeSpentMins).toBe(90);
    expect(job.completion.fuelAmount).toBe(500);
    expect(job.completion.remarksText).toBe("regassed");
    expect(job.completion.materials).toEqual([{ name: "Relay", qty: 2, unitPrice: 600 }]);
    expect(job.revenue).toHaveLength(2);
    expect(job.revenue[0]).toMatchObject({ id: "p1", amount: 4200, method: "cash", voided: false });
    expect(job.revenue[1]).toMatchObject({
      id: "p2",
      amount: 1000,
      voided: true,
      voidReason: "duplicate",
    });
  });

  it("maps the GPS route (fuel paisa→rupees) and the punch pins (P3e)", () => {
    const job = mapApiJob({
      id: "u",
      token: 1,
      status: "ready",
      job_type: "home-visit",
      customer_name: "A",
      appliance_type: "AC",
      problem: "",
      abandoned: false,
      route: { distance_m: 2500, fuel_paisa: 5000 },
      locations: [
        {
          id: "l1",
          kind: "depart_workshop",
          lat: 24.86,
          lng: 67.0,
          is_mock: false,
          captured_at: "2026-06-08T09:00:00Z",
        },
        {
          id: "l2",
          kind: "arrive_customer",
          lat: 24.87,
          lng: 67.01,
          is_mock: true,
          captured_at: "2026-06-08T09:20:00Z",
        },
      ],
    });

    expect(job.route).toEqual({ distanceM: 2500, fuel: 50 }); // 5000 paisa → Rs 50
    expect(job.locations).toHaveLength(2);
    expect(job.locations[1]).toMatchObject({ kind: "arrive_customer", isMock: true });
  });

  it("defaults route to null and locations to [] when absent", () => {
    const job = mapApiJob({
      id: "u",
      token: 1,
      status: "open",
      job_type: "carry-in",
      customer_name: "A",
      appliance_type: "AC",
      problem: "",
      abandoned: false,
    });
    expect(job.route).toBeNull();
    expect(job.locations).toEqual([]);
  });

  it("maps the events array to the timeline and surfaces note-kind events", () => {
    const job = mapApiJob({
      id: "u",
      token: 1,
      status: "open",
      job_type: "carry-in",
      customer_name: "A",
      appliance_type: "Split AC",
      problem: "",
      abandoned: false,
      events: [
        {
          id: "e1",
          kind: "create",
          text: "Job created",
          actor: null,
          created_at: "2026-06-01T09:00:00Z",
        },
        {
          id: "e2",
          kind: "note",
          text: "Note: check capacitor",
          actor: "t2",
          created_at: "2026-06-01T10:00:00Z",
        },
      ],
    });

    expect(job.timeline).toHaveLength(2);
    expect(job.timeline[0].kind).toBe("create");
    expect(job.timeline[1].text).toBe("Note: check capacitor");
    expect(job.timeline[1].by).toBe("t2");
    // note-kind events surface in the notes list with the "Note: " prefix stripped
    expect(job.notes).toEqual([{ text: "check capacitor", by: "t2", label: expect.any(String) }]);
  });

  it("treats a missing events array as an empty timeline", () => {
    const job = mapApiJob({
      id: "u",
      token: 1,
      status: "open",
      job_type: "carry-in",
      customer_name: "A",
      appliance_type: "AC",
      problem: "",
      abandoned: false,
    });
    expect(job.timeline).toEqual([]);
    expect(job.notes).toEqual([]);
  });

  it("defaults missing optional fields", () => {
    const job = mapApiJob({
      id: "x",
      token: 1,
      status: "open",
      job_type: "carry-in",
      customer_name: "Walk-in",
      appliance_type: "Split AC",
      problem: "",
      abandoned: false,
    });
    expect(job.customer.phone).toBe("");
    expect(job.appliance.brand).toBe("");
    expect(job.closedAt).toBeUndefined();
    expect(job.timeWindow).toBeUndefined();
  });
});

describe("toCreateBody", () => {
  it("maps the NewJobForm fields to the API body", () => {
    const body = toCreateBody({
      jobType: "home-visit",
      customerName: "Yusuf",
      customerPhone: "0312-6677889",
      address: "House 31, DHA",
      applianceType: "Split AC",
      brand: "Gree",
      model: "",
      problem: "leaking",
      assignedTechId: "t1",
      preferredDate: "2026-05-30",
      timeWindow: "11 AM – 1 PM",
    });

    expect(body).toEqual({
      job_type: "home-visit",
      customer_name: "Yusuf",
      customer_phone: "0312-6677889",
      customer_address: "House 31, DHA",
      appliance_type: "Split AC",
      appliance_brand: "Gree",
      appliance_model: null, // empty → null
      problem: "leaking",
      assigned_tech_id: "t1",
      preferred_date: "2026-05-30",
      time_window: "11 AM – 1 PM",
    });
  });
});
