/** Battery-exemption tests — expo-battery + expo-intent-launcher mocked. */

import * as Battery from "expo-battery";
import * as IntentLauncher from "expo-intent-launcher";

import { isBatteryOptimizationEnabled, requestBatteryExemption } from "./battery";

jest.mock("expo-battery", () => ({ isBatteryOptimizationEnabledAsync: jest.fn() }));
jest.mock("expo-intent-launcher", () => ({
  startActivityAsync: jest.fn(),
  ActivityAction: {
    REQUEST_IGNORE_BATTERY_OPTIMIZATIONS: "REQUEST_IGNORE",
    IGNORE_BATTERY_OPTIMIZATION_SETTINGS: "SETTINGS_LIST",
  },
}));

const mockedEnabled = Battery.isBatteryOptimizationEnabledAsync as jest.MockedFunction<
  typeof Battery.isBatteryOptimizationEnabledAsync
>;
const mockedStart = IntentLauncher.startActivityAsync as jest.MockedFunction<
  typeof IntentLauncher.startActivityAsync
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedStart.mockResolvedValue({} as never);
});

it("is a no-op when the app is already exempt", async () => {
  mockedEnabled.mockResolvedValue(false); // exempt

  expect(await requestBatteryExemption()).toBe(true);
  expect(mockedStart).not.toHaveBeenCalled();
});

it("opens the direct dialog scoped to the app package when optimization is on", async () => {
  mockedEnabled
    .mockResolvedValueOnce(true) // first probe: optimization on
    .mockResolvedValueOnce(false); // re-probe after the dialog: now exempt

  expect(await requestBatteryExemption()).toBe(true);
  expect(mockedStart).toHaveBeenCalledTimes(1);
  expect(mockedStart).toHaveBeenCalledWith("REQUEST_IGNORE", {
    data: "package:com.fixflow.technician",
  });
});

it("falls back to the settings list when the direct dialog can't be resolved", async () => {
  mockedEnabled
    .mockResolvedValueOnce(true) // optimization on
    .mockResolvedValueOnce(false); // exempt after the fallback
  mockedStart
    .mockRejectedValueOnce(new Error("no activity found")) // direct dialog unavailable
    .mockResolvedValueOnce({} as never); // settings list opens

  expect(await requestBatteryExemption()).toBe(true);
  expect(mockedStart).toHaveBeenNthCalledWith(1, "REQUEST_IGNORE", expect.anything());
  expect(mockedStart).toHaveBeenNthCalledWith(2, "SETTINGS_LIST");
});

it("reports not-exempt if the user backed out (still optimized after the dialog)", async () => {
  mockedEnabled
    .mockResolvedValueOnce(true) // optimization on
    .mockResolvedValueOnce(true); // still on after the dialog

  expect(await requestBatteryExemption()).toBe(false);
});

it("isBatteryOptimizationEnabled swallows probe failures as false (never nags)", async () => {
  mockedEnabled.mockRejectedValueOnce(new Error("unsupported"));

  expect(await isBatteryOptimizationEnabled()).toBe(false);
});
