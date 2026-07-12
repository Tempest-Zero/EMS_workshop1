/**
 * Travel-breadcrumb drain: per-job batches, shared-device rule, and the
 * ping-style failure contract (definitive 4xx → dropped, offline → wait).
 */

let mockStore: Record<string, string> = {};
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mockStore[k] ?? null),
    setItem: (k: string, v: string) => {
      mockStore[k] = v;
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      delete mockStore[k];
      return Promise.resolve();
    },
  },
}));

jest.mock("../../lib/auth", () => ({
  getToken: () => "tok",
  loadToken: () => Promise.resolve("tok"),
  setToken: jest.fn(),
}));

const mockRecord = jest.fn();
jest.mock("../../lib/jobsApi", () => ({
  jobsApi: { recordTravelSamples: (...args: unknown[]) => mockRecord(...args) },
}));

import { ApiError } from "../../lib/api";
import { enqueueTravelSample, loadTravelQueue, type QueuedTravelSample } from "./travelQueue";
import { syncTravelSamples } from "./travelSync";

const sample = (over: Partial<QueuedTravelSample> = {}): QueuedTravelSample => ({
  client_id: `c-${Math.random()}`,
  job_id: "job-1",
  tech_id: "t1",
  leg: "outbound",
  lat: 24.86,
  lng: 67.0,
  accuracy_m: 10,
  is_mock: false,
  captured_at: "2026-07-12T10:00:00Z",
  done: false,
  created_at: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  mockStore = {};
  mockRecord.mockReset();
});

it("drains per-job batches and sweeps the settled rows", async () => {
  await enqueueTravelSample(sample({ client_id: "a", job_id: "job-1" }));
  await enqueueTravelSample(sample({ client_id: "b", job_id: "job-2" }));
  mockRecord.mockResolvedValue({ accepted: 1, deduped: 0, rejected: 0, route: null });

  await syncTravelSamples("t1");

  expect(mockRecord).toHaveBeenCalledTimes(2);
  const jobIds = mockRecord.mock.calls.map((c) => c[0]).sort();
  expect(jobIds).toEqual(["job-1", "job-2"]);
  expect(await loadTravelQueue()).toHaveLength(0);
});

it("only flushes the signed-in tech's samples (shared device)", async () => {
  await enqueueTravelSample(sample({ client_id: "mine", tech_id: "t1" }));
  await enqueueTravelSample(sample({ client_id: "theirs", tech_id: "t2" }));
  mockRecord.mockResolvedValue({ accepted: 1, deduped: 0, rejected: 0, route: null });

  await syncTravelSamples("t1");

  const left = await loadTravelQueue();
  expect(left.map((i) => i.client_id)).toEqual(["theirs"]);
});

it("DROPS a definitively rejected batch (reassigned job → 403) and moves on", async () => {
  await enqueueTravelSample(sample({ client_id: "bad", job_id: "job-reassigned" }));
  await enqueueTravelSample(sample({ client_id: "good", job_id: "job-ok" }));
  mockRecord.mockImplementation((jobId: unknown) =>
    jobId === "job-reassigned"
      ? Promise.reject(new ApiError("POST", "/travel-samples", 403, "not assigned"))
      : Promise.resolve({ accepted: 1, deduped: 0, rejected: 0, route: null }),
  );

  await syncTravelSamples("t1");

  // Both settled: the rejected batch dropped (estimate stands in), the good one landed.
  expect(await loadTravelQueue()).toHaveLength(0);
});

it("a connectivity failure stops the drain and keeps everything", async () => {
  await enqueueTravelSample(sample({ client_id: "a" }));
  mockRecord.mockRejectedValue(new TypeError("network request failed"));

  await syncTravelSamples("t1");

  expect(await loadTravelQueue()).toHaveLength(1);
  expect((await loadTravelQueue())[0]?.done).toBe(false);
});

it("no-ops with nobody signed in", async () => {
  await enqueueTravelSample(sample());
  await syncTravelSamples(null);
  expect(mockRecord).not.toHaveBeenCalled();
});
