/**
 * Travel tracker privacy layers: samples only while a travel session is
 * active, the max-duration failsafe, and the launch reconcile.
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

jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));

const mockStart = jest.fn();
const mockStop = jest.fn();
let mockRunning = false;
jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  hasStartedLocationUpdatesAsync: () => Promise.resolve(mockRunning),
  startLocationUpdatesAsync: (...args: unknown[]) => {
    mockRunning = true;
    return mockStart(...args);
  },
  stopLocationUpdatesAsync: (...args: unknown[]) => {
    mockRunning = false;
    return mockStop(...args);
  },
}));

let mockUuidCounter = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${mockUuidCounter++}` }));

const mockSync = jest.fn();
jest.mock("./travelSync", () => ({
  syncTravelSamples: (...args: unknown[]) => mockSync(...args),
}));

import type * as Location from "expo-location";

import { loadTravelQueue } from "./travelQueue";
import {
  ensureTravelTracking,
  getActiveTravel,
  handleTravelUpdate,
  loadTravelTrail,
  MAX_TRAVEL_MS,
  startJobTravel,
  stopJobTravel,
} from "./travelTracker";

const TECH_KEY = "fixflow_tech";
const TRAVEL_KEY = "jobs.travel.active.v1";

const fix = (over: Partial<Location.LocationObject["coords"]> = {}): Location.LocationObject =>
  ({
    coords: { latitude: 24.86, longitude: 67.0, accuracy: 12, ...over },
    timestamp: Date.now(),
    mocked: false,
  }) as Location.LocationObject;

const signIn = (id = "t1") => {
  mockStore[TECH_KEY] = JSON.stringify({ id, name: "Tech" });
};

beforeEach(() => {
  mockStore = {};
  mockRunning = false;
  mockStart.mockReset().mockResolvedValue(undefined);
  mockStop.mockReset().mockResolvedValue(undefined);
  mockSync.mockReset();
});

it("queues a breadcrumb for the active travel session", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  await handleTravelUpdate([fix()]);

  const queue = await loadTravelQueue();
  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({ job_id: "job-1", tech_id: "t1", leg: "outbound" });
  expect(mockSync).toHaveBeenCalledWith("t1");
});

it("discards the fix and stops when no travel is active", async () => {
  signIn();
  mockRunning = true; // orphaned OS task
  await handleTravelUpdate([fix()]);

  expect(await loadTravelQueue()).toHaveLength(0);
  expect(mockStop).toHaveBeenCalled();
});

it("the max-duration failsafe stops an over-long session and records nothing", async () => {
  signIn();
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    startedAt: new Date(Date.now() - MAX_TRAVEL_MS - 60_000).toISOString(),
  });
  mockRunning = true;

  await handleTravelUpdate([fix()]);

  expect(await loadTravelQueue()).toHaveLength(0);
  expect(mockStop).toHaveBeenCalled();
  expect(mockStore[TRAVEL_KEY]).toBeUndefined(); // session cleared
});

it("another tech's session never records under the current sign-in", async () => {
  signIn("t2");
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    startedAt: new Date().toISOString(),
  });
  mockRunning = true;

  await handleTravelUpdate([fix()]);

  expect(await loadTravelQueue()).toHaveLength(0);
  expect(mockStop).toHaveBeenCalled();
});

it("ensureTravelTracking re-arms an active session after an app kill", async () => {
  signIn();
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    startedAt: new Date().toISOString(),
  });

  await ensureTravelTracking();
  expect(mockStart).toHaveBeenCalled();
});

it("ensureTravelTracking stops an expired session instead of re-arming", async () => {
  signIn();
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    startedAt: new Date(Date.now() - MAX_TRAVEL_MS - 60_000).toISOString(),
  });
  mockRunning = true;

  await ensureTravelTracking();
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockStop).toHaveBeenCalled();
});

it("stopJobTravel clears the session and kicks a final drain", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  await stopJobTravel("t1");

  expect(mockStore[TRAVEL_KEY]).toBeUndefined();
  expect(mockSync).toHaveBeenCalledWith("t1");
});

// ── The on-screen trail (the travel-map polyline) ───────────────────────────
it("mirrors each fix into the session trail", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  await handleTravelUpdate([fix()]);
  await handleTravelUpdate([fix({ latitude: 24.861 })]);

  const trail = await loadTravelTrail();
  expect(trail?.jobId).toBe("job-1");
  expect(trail?.leg).toBe("outbound");
  expect(trail?.points).toHaveLength(2);
  expect(trail?.points[1]).toMatchObject({ lat: 24.861, lng: 67.0 });
});

it("a new job's leg resets the trail instead of appending to the old one", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  await handleTravelUpdate([fix()]);
  await stopJobTravel("t1");

  await startJobTravel("job-2", "t1");
  await handleTravelUpdate([fix({ latitude: 24.9 })]);

  const trail = await loadTravelTrail();
  expect(trail?.jobId).toBe("job-2");
  expect(trail?.points).toHaveLength(1);
});

it("caps the trail at its ring size (oldest points dropped)", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  const many = Array.from({ length: 1005 }, (_, i) => fix({ latitude: 24 + i * 0.0001 }));
  await handleTravelUpdate(many);

  const trail = await loadTravelTrail();
  expect(trail?.points).toHaveLength(1000);
  // The newest survive; the first five were dropped.
  expect(trail?.points[999]?.lat).toBeCloseTo(24 + 1004 * 0.0001, 6);
});

it("stopJobTravel clears the trail — it belongs to the leg", async () => {
  signIn();
  await startJobTravel("job-1", "t1");
  await handleTravelUpdate([fix()]);
  expect(await loadTravelTrail()).not.toBeNull();

  await stopJobTravel("t1");
  expect(await loadTravelTrail()).toBeNull();
});

it("a discarded fix (no active travel) never reaches the trail", async () => {
  signIn();
  mockRunning = true; // orphaned OS task, no active session
  await handleTravelUpdate([fix()]);
  expect(await loadTravelTrail()).toBeNull();
});

// ── The return leg ──────────────────────────────────────────────────────────
it("a return session stamps leg='return' on queue items and the trail", async () => {
  signIn();
  await startJobTravel("job-1", "t1", "return");
  await handleTravelUpdate([fix()]);

  const queue = await loadTravelQueue();
  expect(queue[0]).toMatchObject({ job_id: "job-1", leg: "return" });
  expect((await loadTravelTrail())?.leg).toBe("return");
});

it("switching outbound → return restarts the failsafe clock and the trail", async () => {
  signIn();
  // An outbound leg armed hours ago (but not yet expired).
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    leg: "outbound",
    startedAt: new Date(Date.now() - MAX_TRAVEL_MS + 60_000).toISOString(),
  });
  await startJobTravel("job-1", "t1", "return");

  const state = JSON.parse(mockStore[TRAVEL_KEY]!) as { leg: string; startedAt: string };
  expect(state.leg).toBe("return");
  // A NEW leg gets a fresh startedAt — the outbound's age must not expire it.
  expect(Date.now() - Date.parse(state.startedAt)).toBeLessThan(5_000);
});

it("getActiveTravel reports the armed leg (outbound default for legacy state)", async () => {
  signIn();
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    startedAt: new Date().toISOString(), // pre-return state: no leg field
  });
  expect(await getActiveTravel()).toEqual({ jobId: "job-1", leg: "outbound" });

  await startJobTravel("job-2", "t1", "return");
  expect(await getActiveTravel()).toEqual({ jobId: "job-2", leg: "return" });

  await stopJobTravel("t1");
  expect(await getActiveTravel()).toBeNull();
});

it("ensureTravelTracking re-arms preserving the return leg", async () => {
  signIn();
  mockStore[TRAVEL_KEY] = JSON.stringify({
    jobId: "job-1",
    techId: "t1",
    leg: "return",
    startedAt: new Date().toISOString(),
  });

  await ensureTravelTracking();
  expect(mockStart).toHaveBeenCalled();
  const state = JSON.parse(mockStore[TRAVEL_KEY]!) as { leg: string };
  expect(state.leg).toBe("return"); // not silently reset to outbound
});
