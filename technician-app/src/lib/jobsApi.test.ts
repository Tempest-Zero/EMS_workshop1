/** jobsApi client tests — fetch + AsyncStorage mocked. */

import { jobsApi } from "./jobsApi";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) });
  (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

function firstCall(): [string, RequestInit | undefined] {
  const c = mockFetch.mock.calls[0];
  if (!c) throw new Error("fetch was not called");
  return c as [string, RequestInit | undefined];
}

describe("jobsApi", () => {
  it("list hits /api/jobs", async () => {
    await jobsApi.list();
    expect(firstCall()[0]).toContain("/api/jobs");
  });

  it("claim POSTs to the claim endpoint", async () => {
    await jobsApi.claim("job-1");
    const [url, init] = firstCall();
    expect(url).toContain("/api/jobs/job-1/claim");
    expect(init?.method).toBe("POST");
  });

  it("assign POSTs the tech_id", async () => {
    await jobsApi.assign("job-1", "t3");
    const [url, init] = firstCall();
    expect(url).toContain("/api/jobs/job-1/assign");
    expect(JSON.parse(init?.body as string).tech_id).toBe("t3");
  });

  it("recordLocation POSTs a GPS punch with its client_id", async () => {
    await jobsApi.recordLocation("job-1", {
      kind: "depart_workshop",
      lat: 24.8607,
      lng: 67.0011,
      accuracy_m: 12,
      is_mock: false,
      client_id: "cid-1",
    });
    const [url, init] = firstCall();
    expect(url).toContain("/api/jobs/job-1/locations");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.kind).toBe("depart_workshop");
    expect(body.lat).toBe(24.8607);
    expect(body.is_mock).toBe(false);
    expect(body.client_id).toBe("cid-1");
  });

  it("surfaces a timeout error when the request aborts", async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    await expect(jobsApi.list()).rejects.toThrow(/timed out/);
  });
});
