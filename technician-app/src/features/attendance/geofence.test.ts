/**
 * Geofence handler tests — every OS/feature dependency mocked, so we exercise
 * the decide-and-act logic (record + when to notify) without a device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { attendanceApi } from "../../lib/attendanceApi";
import { notifyArrived, notifyLeaving } from "./attendanceNotifications";
import { handleGeofenceEvent } from "./geofence";
import { getLocation } from "./location";
import { enqueuePresence } from "./presenceQueue";

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
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("expo-location", () => ({ GeofencingEventType: { Enter: 1, Exit: 2 } }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-" + Math.random() }));
jest.mock("../../lib/auth", () => ({ getToken: () => "tok", loadToken: jest.fn() }));
jest.mock("../../lib/attendanceApi", () => ({
  attendanceApi: { today: jest.fn(), activeGeofence: jest.fn() },
}));
jest.mock("./location", () => ({
  getLocation: jest.fn(async () => ({
    lat: 24.86,
    lng: 67.0,
    accuracy_m: 10,
    is_mock_location: false,
  })),
}));
jest.mock("./wifi", () => ({ getWifi: jest.fn(async () => ({ wifi_bssid: null, wifi_ssid: null })) }));
jest.mock("./attendanceNotifications", () => ({
  notifyArrived: jest.fn(),
  notifyLeaving: jest.fn(),
}));
jest.mock("./presenceQueue", () => ({ enqueuePresence: jest.fn() }));
jest.mock("./presenceSync", () => ({ syncPresence: jest.fn() }));

const mockedToday = attendanceApi.today as jest.MockedFunction<typeof attendanceApi.today>;
const mockedEnqueue = enqueuePresence as jest.MockedFunction<typeof enqueuePresence>;
const mockedArrived = notifyArrived as jest.MockedFunction<typeof notifyArrived>;
const mockedLeaving = notifyLeaving as jest.MockedFunction<typeof notifyLeaving>;
const mockedGetLocation = getLocation as jest.MockedFunction<typeof getLocation>;

const ENTER = Location.GeofencingEventType.Enter;
const EXIT = Location.GeofencingEventType.Exit;

// The cached-fence key confirmCrossing reads (mirrors geofence.ts).
const FENCE_CACHE_KEY = "attendance.geofence.cache.v1";

async function signIn(id = "t1") {
  await AsyncStorage.setItem("fixflow_tech", JSON.stringify({ id }));
}

function today(clocked_in: boolean) {
  return { tech_id: "t1", clocked_in, last_in: null, last_out: null };
}

/** A fix ~`m` metres north of the fence centre (0.001 deg lat ≈ 111 m). */
function fixAtMeters(m: number, accuracy_m = 10) {
  return { lat: 24.86 + m / 111_190, lng: 67.0, accuracy_m, is_mock_location: false };
}

async function setFence(radius_m: number) {
  await AsyncStorage.setItem(
    FENCE_CACHE_KEY,
    JSON.stringify({
      name: "Workshop",
      center_lat: 24.86,
      center_lng: 67.0,
      radius_m,
      is_active: true,
    }),
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  // A clean per-test baseline so a prior test's fix override never leaks
  // (clearAllMocks resets calls, not implementations).
  mockedGetLocation.mockResolvedValue(fixAtMeters(0));
});

it("ENTER while signed in & off-duty: logs arrival and prompts clock-in", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "arrive", tech_id: "t1" }),
  );
  expect(mockedArrived).toHaveBeenCalled();
  expect(mockedLeaving).not.toHaveBeenCalled();
});

it("ENTER while already clocked in: logs arrival but does NOT nag", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(true));

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "arrive" }));
  expect(mockedArrived).not.toHaveBeenCalled();
});

it("ENTER when clock-state is unknown (offline): still reminds", async () => {
  await signIn();
  mockedToday.mockRejectedValue(new Error("offline"));

  await handleGeofenceEvent(ENTER);

  expect(mockedArrived).toHaveBeenCalled(); // err toward reminding
});

it("EXIT while clocked in: logs departure and prompts clock-out", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(true));

  await handleGeofenceEvent(EXIT);

  expect(mockedEnqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "depart" }));
  expect(mockedLeaving).toHaveBeenCalled();
});

it("EXIT while not clocked in: logs departure but does NOT nag", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));

  await handleGeofenceEvent(EXIT);

  expect(mockedEnqueue).toHaveBeenCalledWith(expect.objectContaining({ kind: "depart" }));
  expect(mockedLeaving).not.toHaveBeenCalled();
});

it("does nothing when nobody is signed in", async () => {
  mockedToday.mockResolvedValue(today(false));

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).not.toHaveBeenCalled();
  expect(mockedArrived).not.toHaveBeenCalled();
});

it("debounces a repeated identical crossing within the window", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));

  await handleGeofenceEvent(ENTER);
  await handleGeofenceEvent(ENTER); // boundary jitter — should be ignored

  expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  expect(mockedArrived).toHaveBeenCalledTimes(1);
});

// ── D5 crossing confirmation ──────────────────────────────────────────────
it("ENTER confirmed by a fix inside the fence records confirmed:true", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));
  await setFence(100);
  mockedGetLocation.mockResolvedValue(fixAtMeters(0)); // dead centre → inside

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "arrive", confirmed: true }),
  );
  expect(mockedArrived).toHaveBeenCalled();
});

it("a coarse fix can't judge the fence: unknown → records confirmed:null and still notifies", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));
  await setFence(100);
  mockedGetLocation.mockResolvedValue(fixAtMeters(0, 150)); // accuracy 150 > 100 ceiling

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "arrive", confirmed: null }),
  );
  expect(mockedArrived).toHaveBeenCalled(); // unknown trusts the OS event
});

it("with no cached fence the crossing is unknown (confirmed:null) but still notifies", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(false));
  // no setFence → nothing to judge against
  mockedGetLocation.mockResolvedValue(fixAtMeters(0));

  await handleGeofenceEvent(ENTER);

  expect(mockedEnqueue).toHaveBeenCalledWith(expect.objectContaining({ confirmed: null }));
  expect(mockedArrived).toHaveBeenCalled();
});

it("EXIT clearly outside (past the hysteresis band) records confirmed:true and prompts clock-out", async () => {
  await signIn();
  mockedToday.mockResolvedValue(today(true));
  await setFence(100); // exit threshold = max(150, 140) = 150 m
  mockedGetLocation.mockResolvedValue(fixAtMeters(200)); // 200 ≥ 150 → clearly out

  await handleGeofenceEvent(EXIT);

  expect(mockedEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "depart", confirmed: true }),
  );
  expect(mockedLeaving).toHaveBeenCalled();
});

it("EXIT inside the hysteresis band is contradicted after a dwell re-check: confirmed:false, no nag", async () => {
  jest.useFakeTimers();
  try {
    await signIn();
    mockedToday.mockResolvedValue(today(true));
    await setFence(100); // threshold 150 m
    mockedGetLocation.mockResolvedValue(fixAtMeters(120)); // past radius, inside band → flap

    const p = handleGeofenceEvent(EXIT);
    await jest.advanceTimersByTimeAsync(20_000); // the 20s dwell re-check
    await p;

    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "depart", confirmed: false }),
    );
    expect(mockedLeaving).not.toHaveBeenCalled(); // suppressed — flap noise dies
  } finally {
    jest.useRealTimers();
  }
});

it("dwell re-check: a second fix that clears the band confirms the EXIT and nags", async () => {
  jest.useFakeTimers();
  try {
    await signIn();
    mockedToday.mockResolvedValue(today(true));
    await setFence(100);
    mockedGetLocation
      .mockResolvedValueOnce(fixAtMeters(120)) // first fix flaps (inside band)
      .mockResolvedValueOnce(fixAtMeters(200)); // after dwell: clearly outside

    const p = handleGeofenceEvent(EXIT);
    await jest.advanceTimersByTimeAsync(20_000);
    await p;

    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "depart", confirmed: true }),
    );
    expect(mockedLeaving).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
