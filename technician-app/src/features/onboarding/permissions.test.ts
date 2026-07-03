/** Permission-priming tests — location, notifications, battery, storage mocked. */

import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

import { requestBatteryExemption } from "./battery";
import { requestAttendancePermissions } from "./permissions";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));
jest.mock("expo-location", () => ({
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock("./battery", () => ({ requestBatteryExemption: jest.fn() }));

const granted = { granted: true } as never;
const mockedBattery = requestBatteryExemption as jest.MockedFunction<typeof requestBatteryExemption>;

beforeEach(() => {
  jest.clearAllMocks();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue(granted);
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
  (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue(granted);
  mockedBattery.mockResolvedValue(true);
});

it("returns the battery-exemption result alongside the location grants", async () => {
  const result = await requestAttendancePermissions();
  expect(result).toEqual({
    notifications: true,
    foreground: true,
    background: true,
    batteryExempt: true,
  });
});

it("requests the battery exemption LAST — after background location", async () => {
  await requestAttendancePermissions();

  const bgOrder = (Location.getBackgroundPermissionsAsync as jest.Mock).mock.invocationCallOrder[0];
  const batteryOrder = mockedBattery.mock.invocationCallOrder[0];
  expect(batteryOrder).toBeGreaterThan(bgOrder ?? 0);
});
