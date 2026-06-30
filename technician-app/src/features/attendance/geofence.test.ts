/**
 * Geofence handler tests — every OS/feature dependency mocked, so we exercise
 * the decide-and-act logic (record + when to notify) without a device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { attendanceApi } from "../../lib/attendanceApi";
import { notifyArrived, notifyLeaving } from "./attendanceNotifications";
import { handleGeofenceEvent } from "./geofence";
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

const ENTER = Location.GeofencingEventType.Enter;
const EXIT = Location.GeofencingEventType.Exit;

async function signIn(id = "t1") {
  await AsyncStorage.setItem("fixflow_tech", JSON.stringify({ id }));
}

function today(clocked_in: boolean) {
  return { tech_id: "t1", clocked_in, last_in: null, last_out: null };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
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
