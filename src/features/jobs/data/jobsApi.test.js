import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fetchJobs,
  fetchEvidenceGaps,
  createJob,
  assignJob,
  addJobNote,
  addJobFollowup,
  transitionJob,
  submitCompletion,
  negotiateBill,
  logPayment,
  voidPayment,
} from "./jobsApi";

beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
  );
});

describe("jobsApi", () => {
  it("fetchJobs with no params hits the bare endpoint", async () => {
    await fetchJobs();
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/jobs");
    expect(url).not.toContain("?");
  });

  it("fetchJobs drops empty params and keeps the rest", async () => {
    await fetchJobs({ status: "open", tech_id: "", q: "ac" });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("status=open");
    expect(url).toContain("q=ac");
    expect(url).not.toContain("tech_id");
  });

  it("createJob posts the body", async () => {
    await createJob({ customer_name: "A", appliance_type: "AC" });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).customer_name).toBe("A");
  });

  it("assignJob posts the tech_id to the assign endpoint", async () => {
    await assignJob("job-1", "t3");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/assign");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ tech_id: "t3" });
  });

  it("addJobNote posts the text to the notes endpoint", async () => {
    await addJobNote("job-1", "check capacitor");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/notes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "check capacitor" });
  });

  it("addJobFollowup posts to the followups endpoint", async () => {
    await addJobFollowup("job-1", "called customer");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/followups");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).text).toBe("called customer");
  });

  it("transitionJob posts the action body to the transition endpoint", async () => {
    await transitionJob("job-1", { action: "abandon", reason: "irreparable" });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/transition");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ action: "abandon", reason: "irreparable" });
  });

  it("submitCompletion posts the paisa body to the completion endpoint", async () => {
    const body = {
      materials: [{ name: "Relay", qty: 2, unit_paisa: 60000 }],
      time_spent_mins: 90,
      fuel_paisa: 50000,
      remarks_text: "replaced relay",
    };
    await submitCompletion("job-1", body);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/completion");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("negotiateBill posts amount_paisa + note", async () => {
    await negotiateBill("job-1", 420000, "waived call-out");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/bill/negotiate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ amount_paisa: 420000, note: "waived call-out" });
  });

  it("negotiateBill sends null note when omitted", async () => {
    await negotiateBill("job-1", 420000);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).note).toBeNull();
  });

  it("logPayment posts amount_paisa, method and client_id", async () => {
    await logPayment("job-1", 100000, "cash", "client-uuid-1");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/payments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      amount_paisa: 100000,
      method: "cash",
      client_id: "client-uuid-1",
    });
  });

  it("voidPayment posts the reason to the nested void endpoint", async () => {
    await voidPayment("job-1", "pay-9", "duplicate entry");
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/jobs/job-1/payments/pay-9/void");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ reason: "duplicate entry" });
  });
});

describe("evidence gaps", () => {
  it("fetchEvidenceGaps hits the reconciliation endpoint", async () => {
    await fetchEvidenceGaps();
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/jobs/evidence-gaps");
  });
});
