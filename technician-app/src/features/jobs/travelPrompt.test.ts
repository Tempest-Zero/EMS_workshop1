/** Geofence-exit travel nudge: candidate selection, punch/active-travel skips,
 * and the debounce. AsyncStorage + notifications + caches mocked. */

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

const mockLoadJobsList = jest.fn();
const mockLoadJobDetail = jest.fn();
jest.mock("../../lib/jobsCache", () => ({
  loadJobsList: (...a: unknown[]) => mockLoadJobsList(...a),
  loadJobDetail: (...a: unknown[]) => mockLoadJobDetail(...a),
}));

const mockHasActiveTravel = jest.fn();
jest.mock("./travelTracker", () => ({
  hasActiveTravel: (...a: unknown[]) => mockHasActiveTravel(...a),
}));

import type { Job } from "../../lib/jobsApi";
import { maybePromptTravel } from "./travelPrompt";

const job = (over: Partial<Job> = {}): Job =>
  ({
    id: "j1",
    token: 11,
    status: "open",
    job_type: "home-visit",
    assigned_tech_id: "t1",
    ...over,
  }) as unknown as Job;

const listOf = (...jobs: Job[]) => ({ data: jobs, savedAt: "2026-07-12T10:00:00Z" });

beforeEach(() => {
  mockStore = {};
  mockSchedule.mockClear();
  mockLoadJobsList.mockReset();
  mockLoadJobDetail.mockReset();
  mockHasActiveTravel.mockReset();
  mockHasActiveTravel.mockResolvedValue(false);
  mockLoadJobDetail.mockResolvedValue(null); // no cached detail → keep candidate
});

it("nudges for an assigned, open, punch-less visit job", async () => {
  mockLoadJobsList.mockResolvedValue(listOf(job()));
  await maybePromptTravel("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const arg = mockSchedule.mock.calls[0]![0] as { content: { data: { id?: string; token?: number } } };
  expect(arg.content.data.id).toBe("j1");
  expect(arg.content.data.token).toBe(11);
});

it("ignores carry-in jobs (no travel)", async () => {
  mockLoadJobsList.mockResolvedValue(listOf(job({ job_type: "carry-in" })));
  await maybePromptTravel("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("ignores another tech's jobs and closed jobs", async () => {
  mockLoadJobsList.mockResolvedValue(
    listOf(job({ assigned_tech_id: "t2" }), job({ id: "j2", status: "closed" })),
  );
  await maybePromptTravel("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("skips when a breadcrumb leg is already active", async () => {
  mockHasActiveTravel.mockResolvedValue(true);
  mockLoadJobsList.mockResolvedValue(listOf(job()));
  await maybePromptTravel("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("skips a job that already has a depart punch cached", async () => {
  mockLoadJobsList.mockResolvedValue(listOf(job()));
  mockLoadJobDetail.mockResolvedValue({
    data: { locations: [{ kind: "depart_workshop" }] },
    savedAt: "t",
  });
  await maybePromptTravel("t1");
  expect(mockSchedule).not.toHaveBeenCalled();
});

it("omits the job id when several jobs qualify (fallback to the hub)", async () => {
  mockLoadJobsList.mockResolvedValue(listOf(job(), job({ id: "j2", token: 12 })));
  await maybePromptTravel("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const arg = mockSchedule.mock.calls[0]![0] as { content: { data: { id?: string } } };
  expect(arg.content.data.id).toBeUndefined();
});

it("debounces — a second exit within the window does not re-nudge", async () => {
  mockLoadJobsList.mockResolvedValue(listOf(job()));
  await maybePromptTravel("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  await maybePromptTravel("t1");
  expect(mockSchedule).toHaveBeenCalledTimes(1); // still once
});
