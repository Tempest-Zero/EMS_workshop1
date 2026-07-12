/**
 * The pending-media queue: voice notes captured before their job exists
 * server-side. Contract mirrors the outbox — never a silent drop; definitive
 * rejections park visibly; connectivity failures wait.
 */

const mockStore: Record<string, string> = {};
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

jest.mock("../../lib/auth", () => ({
  getToken: () => "tok",
  loadToken: () => Promise.resolve("tok"),
  setToken: jest.fn(),
}));

const mockList = jest.fn();
jest.mock("../../lib/jobsApi", () => ({
  jobsApi: { list: (...args: unknown[]) => mockList(...args) },
}));

const mockUpload = jest.fn();
jest.mock("./uploadMedia", () => ({
  uploadMedia: (...args: unknown[]) => mockUpload(...args),
}));

import { ApiError } from "../../lib/api";
import {
  drainPendingMedia,
  enqueuePendingMedia,
  listPendingMedia,
} from "./pendingMedia";

const ENTRY = {
  id: "intake:cid-1",
  jobClientId: "cid-1",
  phase: "intake" as const,
  type: "audio" as const,
  uri: "file:///tmp/problem.m4a",
  filename: "problem.m4a",
  contentType: "audio/mp4",
};

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockList.mockReset();
  mockUpload.mockReset();
});

it("enqueue is idempotent on id", async () => {
  await enqueuePendingMedia(ENTRY);
  await enqueuePendingMedia(ENTRY);
  expect(await listPendingMedia()).toHaveLength(1);
});

it("drains an entry once its job exists (client_id → token join)", async () => {
  await enqueuePendingMedia(ENTRY);
  mockList.mockResolvedValue([{ id: "j1", token: 1077, client_id: "cid-1" }]);
  mockUpload.mockResolvedValue({});

  await drainPendingMedia();

  expect(mockUpload).toHaveBeenCalledWith(
    expect.objectContaining({ jobId: "1077", phase: "intake", uri: ENTRY.uri }),
  );
  expect(await listPendingMedia()).toHaveLength(0);
});

it("keeps waiting while the create hasn't synced (no matching job)", async () => {
  await enqueuePendingMedia(ENTRY);
  mockList.mockResolvedValue([{ id: "j2", token: 1078, client_id: "other" }]);

  await drainPendingMedia();

  expect(mockUpload).not.toHaveBeenCalled();
  expect(await listPendingMedia()).toHaveLength(1);
});

it("keeps everything when the roster fetch fails (offline)", async () => {
  await enqueuePendingMedia(ENTRY);
  mockList.mockRejectedValue(new TypeError("network request failed"));

  await drainPendingMedia();

  expect(await listPendingMedia()).toHaveLength(1);
});

it("parks a definitive rejection visibly and never retries it", async () => {
  await enqueuePendingMedia(ENTRY);
  mockList.mockResolvedValue([{ id: "j1", token: 1077, client_id: "cid-1" }]);
  mockUpload.mockRejectedValue(new ApiError("POST", "/api/jobs/1077/media", 413, "too large"));

  await drainPendingMedia();
  const [parked] = await listPendingMedia();
  expect(parked?.failedReason).toContain("413");

  // Second drain: still there, upload NOT re-attempted.
  mockUpload.mockClear();
  await drainPendingMedia();
  expect(mockUpload).not.toHaveBeenCalled();
  expect(await listPendingMedia()).toHaveLength(1);
});

it("a connectivity failure mid-drain keeps the entry for the next trigger", async () => {
  await enqueuePendingMedia(ENTRY);
  mockList.mockResolvedValue([{ id: "j1", token: 1077, client_id: "cid-1" }]);
  mockUpload.mockRejectedValue(new TypeError("network request failed"));

  await drainPendingMedia();

  expect(await listPendingMedia()).toHaveLength(1);
  expect((await listPendingMedia())[0]?.failedReason).toBeUndefined();
});
