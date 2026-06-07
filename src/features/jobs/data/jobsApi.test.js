import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchJobs, createJob, addJobNote, addJobFollowup, transitionJob } from "./jobsApi";

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
});
