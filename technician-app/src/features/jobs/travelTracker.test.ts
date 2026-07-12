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
  handleTravelUpdate,
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
