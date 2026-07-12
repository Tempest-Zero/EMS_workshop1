/** Travel-breadcrumb queue: local dedup, the deliberate cap, sync-state sweep. */

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

import {
  enqueueTravelSample,
  loadTravelQueue,
  markTravelSamplesDone,
  MAX_UNSENT_SAMPLES,
  pendingTravelSamples,
  removeTravelSamples,
  type QueuedTravelSample,
} from "./travelQueue";

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
});

it("dedups on client_id", async () => {
  const s = sample({ client_id: "fixed" });
  await enqueueTravelSample(s);
  await enqueueTravelSample(s);
  expect(await loadTravelQueue()).toHaveLength(1);
});

it("caps the unsent backlog oldest-first (droppable by design)", async () => {
  for (let i = 0; i < MAX_UNSENT_SAMPLES; i++) {
    await enqueueTravelSample(
      sample({ client_id: `c-${i}`, created_at: new Date(2026, 0, 1, 0, 0, i).toISOString() }),
    );
  }
  await enqueueTravelSample(sample({ client_id: "newest", created_at: "2026-07-12T00:00:00Z" }));

  const queue = await loadTravelQueue();
  expect(queue).toHaveLength(MAX_UNSENT_SAMPLES);
  expect(queue.some((i) => i.client_id === "c-0")).toBe(false); // oldest dropped
  expect(queue.some((i) => i.client_id === "newest")).toBe(true);
});

it("mark-done removes from pending; remove sweeps the rows", async () => {
  await enqueueTravelSample(sample({ client_id: "a" }));
  await enqueueTravelSample(sample({ client_id: "b" }));

  await markTravelSamplesDone(["a"]);
  expect((await pendingTravelSamples()).map((i) => i.client_id)).toEqual(["b"]);

  await removeTravelSamples(["a"]);
  expect(await loadTravelQueue()).toHaveLength(1);
});
