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

beforeEach(() => {
  (global as { fetch: jest.Mock }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }),
  );
});

function calls(): [string, RequestInit][] {
  return (global.fetch as unknown as jest.Mock).mock.calls;
}

describe("jobsApi", () => {
  it("list hits /api/jobs", async () => {
    await jobsApi.list();
    expect(calls()[0][0]).toContain("/api/jobs");
  });

  it("claim POSTs to the claim endpoint", async () => {
    await jobsApi.claim("job-1");
    const [url, init] = calls()[0];
    expect(url).toContain("/api/jobs/job-1/claim");
    expect(init.method).toBe("POST");
  });

  it("assign POSTs the tech_id", async () => {
    await jobsApi.assign("job-1", "t3");
    const [url, init] = calls()[0];
    expect(url).toContain("/api/jobs/job-1/assign");
    expect(JSON.parse(init.body as string).tech_id).toBe("t3");
  });
});
