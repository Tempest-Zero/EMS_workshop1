/** Geofence-enter "back at the workshop?" nudge: fires only for an armed
 * RETURN leg with a cached job token, debounced. Mirrors travelPrompt.test. */

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

const mockSchedule = jest.fn((..._a: unknown[]) => Promise.resolve());
jest.mock("expo-notifications", () => ({
  __esModule: true,
  scheduleNotificationAsync: (...a: unknown[]) => mockSchedule(...a),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { DEFAULT: 3 },
}));

const mockLoadJobDetail = jest.fn();
jest.mock("../../lib/jobsCache", () => ({
  loadJobDetail: (...a: unknown[]) => mockLoadJobDetail(...a),
}));

const mockGetActiveTravel = jest.fn();
jest.mock("./travelTracker", () => ({
  getActiveTravel: (...a: unknown[]) => mockGetActiveTravel(...a),
}));

import { maybePromptReturn } from "./returnPrompt";

beforeEach(() => {
  mockStore = {};
  mockSchedule.mockClear();
  mockLoadJobDetail.mockReset();
  mockGetActiveTravel.mockReset();
  mockGetActiveTravel.mockResolvedValue(null);
  mockLoadJobDetail.mockResolvedValue({ data: { token: 42 }, savedAt: "t" });
});

it("nudges when a return leg is armed and the job token is cached", async () => {
  mockGetActiveTravel.mockResolvedValue({ jobId: "j1", leg: "return" });
  await maybePromptReturn("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const arg = mockSchedule.mock.calls[0]![0] as {
    content: { data: { type: string; id: string; token: number } };
  };
  expect(arg.content.data).toEqual({ type: "return_prompt", id: "j1", token: 42 });
});

it("stays silent with no active travel", async () => {
  await maybePromptReturn("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("stays silent while the OUTBOUND leg is armed (entering ≠ returning)", async () => {
  mockGetActiveTravel.mockResolvedValue({ jobId: "j1", leg: "outbound" });
  await maybePromptReturn("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("stays silent without a cached job detail (nothing to deep-link)", async () => {
  mockGetActiveTravel.mockResolvedValue({ jobId: "j1", leg: "return" });
  mockLoadJobDetail.mockResolvedValue(null);
  await maybePromptReturn("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("debounces — a boundary flap does not re-nudge", async () => {
  mockGetActiveTravel.mockResolvedValue({ jobId: "j1", leg: "return" });
  await maybePromptReturn("t1");
  await maybePromptReturn("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1);
});
