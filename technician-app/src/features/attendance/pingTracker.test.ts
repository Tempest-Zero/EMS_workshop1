/**
 * Ping-tracker tests — OS location, queue, and sync mocked. Exercises the
 * decide-and-act task body (`handlePingUpdate`) and the reconcile matrix.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { notifyDutyAutoStopped } from "./attendanceNotifications";
import { enqueuePing } from "./pingQueue";
import { syncPings } from "./pingSync";
import {
  ensurePingTracking,
  handlePingUpdate,
  PING_TASK,
  startDutyPings,
} from "./pingTracker";
import { loadQueue, type QueuedPunch } from "./queue";

jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-" + Math.random() }));
jest.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
}));
jest.mock("./queue", () => ({ loadQueue: jest.fn() }));
jest.mock("./pingQueue", () => ({ enqueuePing: jest.fn() }));
jest.mock("./pingSync", () => ({ syncPings: jest.fn() }));
jest.mock("./attendanceNotifications", () => ({ notifyDutyAutoStopped: jest.fn() }));
jest.mock("./wifi", () => ({
  getWifi: jest.fn(async () => ({ wifi_bssid: null, wifi_ssid: null })),
}));
jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
        return Promise.resolve();
      }),
      removeItem: jest.fn((k: string) => {
        delete store[k];
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = {};
        return Promise.resolve();
      }),
    },
  };
});

const mockedStart = Location.startLocationUpdatesAsync as jest.MockedFunction<
  typeof Location.startLocationUpdatesAsync
>;
const mockedStop = Location.stopLocationUpdatesAsync as jest.MockedFunction<
  typeof Location.stopLocationUpdatesAsync
>;
const mockedHasStarted = Location.hasStartedLocationUpdatesAsync as jest.MockedFunction<
  typeof Location.hasStartedLocationUpdatesAsync
>;
const mockedEnqueue = enqueuePing as jest.MockedFunction<typeof enqueuePing>;
const mockedLoadQueue = loadQueue as jest.MockedFunction<typeof loadQueue>;
const mockedSync = syncPings as jest.MockedFunction<typeof syncPings>;
const mockedNotify = notifyDutyAutoStopped as jest.MockedFunction<typeof notifyDutyAutoStopped>;

const DUTY_KEY = "attendance.duty.v1";
const HOUR_MS = 60 * 60 * 1000;

const FIX_TS = Date.parse("2026-06-03T09:00:00.000Z");
const fix = {
  coords: { latitude: 24.86, longitude: 67.0, accuracy: 12 },
  timestamp: FIX_TS,
  mocked: false,
} as unknown as Location.LocationObject;

// dutyStatus reads only tech_id / kind / device_time off the latest local punch.
// device_time drives the max-duration cap, so it must be RELATIVE to now —
// default a minute ago (fresh), pass a larger age to simulate a long/forgotten
// session.
function localPunch(kind: "clock_in" | "clock_out", ageMs = 60_000): QueuedPunch {
  return {
    tech_id: "t1",
    kind,
    device_time: new Date(Date.now() - ageMs).toISOString(),
  } as unknown as QueuedPunch;
}

async function signIn(id = "t1") {
  await AsyncStorage.setItem("fixflow_tech", JSON.stringify({ id }));
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockedHasStarted.mockResolvedValue(false);
  mockedLoadQueue.mockResolvedValue([]);
});

// ── the headless task body ────────────────────────────────────────────────
it("on-duty: queues a ping (captured_at = fix time) and kicks a sync", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in")]);

  await handlePingUpdate([fix]);

  expect(mockedEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({
      tech_id: "t1",
      captured_at: new Date(FIX_TS).toISOString(),
      lat: 24.86,
      lng: 67.0,
      accuracy_m: 12,
    }),
  );
  expect(mockedSync).toHaveBeenCalledWith("t1");
  expect(mockedStop).not.toHaveBeenCalled();
});

it("off-duty: discards the fix and stops the sampler (privacy)", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_out")]); // latest punch = off duty
  mockedHasStarted.mockResolvedValue(true); // a stray update is arriving

  await handlePingUpdate([fix]);

  expect(mockedEnqueue).not.toHaveBeenCalled(); // fix discarded
  expect(mockedStop).toHaveBeenCalledWith(PING_TASK); // sampler stopped
});

it("nobody signed in: records nothing and stops", async () => {
  mockedHasStarted.mockResolvedValue(true);

  await handlePingUpdate([fix]);

  expect(mockedEnqueue).not.toHaveBeenCalled();
  expect(mockedStop).toHaveBeenCalledWith(PING_TASK);
});

// ── ensurePingTracking reconcile matrix ────────────────────────────────────
it("reconcile — on-duty ∧ not running → starts (with the foreground service)", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in")]);
  mockedHasStarted.mockResolvedValue(false);

  await ensurePingTracking();

  expect(mockedStart).toHaveBeenCalledWith(
    PING_TASK,
    expect.objectContaining({
      foregroundService: expect.objectContaining({ notificationTitle: expect.any(String) }),
    }),
  );
  expect(mockedStop).not.toHaveBeenCalled();
});

it("reconcile — off-duty ∧ running → stops", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_out")]);
  mockedHasStarted.mockResolvedValue(true);

  await ensurePingTracking();

  expect(mockedStop).toHaveBeenCalledWith(PING_TASK);
  expect(mockedStart).not.toHaveBeenCalled();
});

it("reconcile — on-duty ∧ already running → no-op", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in")]);
  mockedHasStarted.mockResolvedValue(true);

  await ensurePingTracking();

  expect(mockedStart).not.toHaveBeenCalled();
  expect(mockedStop).not.toHaveBeenCalled();
});

it("reconcile — nobody signed in ∧ running → stops", async () => {
  mockedHasStarted.mockResolvedValue(true);

  await ensurePingTracking();

  expect(mockedStop).toHaveBeenCalledWith(PING_TASK);
});

// ── max-duration failsafe (forgot-to-clock-out) ────────────────────────────
it("over the cap: the headless task discards the fix, stops, and notifies", async () => {
  await signIn();
  // A clock_in from 15h ago — past the 14h ceiling — the tech never clocked out.
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in", 15 * HOUR_MS)]);
  mockedHasStarted.mockResolvedValue(true);

  await handlePingUpdate([fix]);

  expect(mockedEnqueue).not.toHaveBeenCalled(); // fix discarded, not recorded
  expect(mockedStop).toHaveBeenCalledWith(PING_TASK);
  expect(mockedNotify).toHaveBeenCalledTimes(1);
});

it("expired session refuses to re-arm and notifies only ONCE across reconciles", async () => {
  // The re-arm hole: a stale clock_in punch stuck in the queue (e.g. a failed
  // sync) keeps reporting expired on every launch. It must never re-arm, and
  // the nudge must fire once — not on every reconcile.
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in", 20 * HOUR_MS)]);
  mockedHasStarted.mockResolvedValue(true);

  await ensurePingTracking();
  await ensurePingTracking();

  expect(mockedStart).not.toHaveBeenCalled(); // never re-armed
  expect(mockedStop).toHaveBeenCalledWith(PING_TASK);
  expect(mockedNotify).toHaveBeenCalledTimes(1); // one-shot, not per-reconcile
});

it("a fresh (well under cap) clock_in still tracks normally", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([localPunch("clock_in", 2 * HOUR_MS)]);

  await handlePingUpdate([fix]);

  expect(mockedEnqueue).toHaveBeenCalled();
  expect(mockedNotify).not.toHaveBeenCalled();
});

it("startDutyPings preserves the original startedAt across a relaunch re-arm", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([]); // punch already synced + pruned
  const started = new Date(Date.now() - 3 * HOUR_MS).toISOString();
  await AsyncStorage.setItem(
    DUTY_KEY,
    JSON.stringify({ techId: "t1", clockedIn: true, startedAt: started }),
  );

  await startDutyPings("t1"); // the launch reconcile re-arms

  const cache = JSON.parse((await AsyncStorage.getItem(DUTY_KEY)) ?? "{}");
  expect(cache.startedAt).toBe(started); // NOT reset to now — the clock keeps running
});

it("legacy duty cache without startedAt is treated as on-duty and patched", async () => {
  await signIn();
  mockedLoadQueue.mockResolvedValue([]); // fall through to the cache
  await AsyncStorage.setItem(DUTY_KEY, JSON.stringify({ techId: "t1", clockedIn: true }));
  mockedHasStarted.mockResolvedValue(false);

  await ensurePingTracking();

  expect(mockedStart).toHaveBeenCalled(); // still on duty (not hard-stopped)
  const cache = JSON.parse((await AsyncStorage.getItem(DUTY_KEY)) ?? "{}");
  expect(cache.startedAt).toBeDefined(); // adopted "now" so the cap can start counting
});
