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
    // Not-yet-API-backed sections come back empty so the UI renders.
    expect(job.estimate.status).toBe("none");
    expect(job.notes).toEqual([]);
    expect(job.timeline).toEqual([]);
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
