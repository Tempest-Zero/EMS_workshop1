import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchJobMedia } from "./mediaApi";

beforeEach(() => {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ before: [], after: [] }),
    })
  );
});

describe("mediaApi", () => {
  it("fetchJobMedia hits the job media endpoint", async () => {
    await fetchJobMedia("1051");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/jobs/1051/media");
  });

  it("url-encodes the job key", async () => {
    await fetchJobMedia("demo job");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/jobs/demo%20job/media");
  });
});
