/** Presence-sync tests — api, queue, and auth mocked (no network/storage). */

import { ApiError } from "../../lib/api";
import { attendanceApi } from "../../lib/attendanceApi";
import { getToken, loadToken } from "../../lib/auth";
import {
  bumpPresenceAttempts,
  markPresenceDone,
  markPresenceFailed,
  pendingPresence,
  removePresence,
  type QueuedPresence,
} from "./presenceQueue";
import { syncPresence } from "./presenceSync";

jest.mock("../../lib/attendanceApi", () => ({
  attendanceApi: { recordPresence: jest.fn() },
}));
jest.mock("../../lib/auth", () => ({
  getToken: jest.fn(),
  loadToken: jest.fn(),
}));
jest.mock("./presenceQueue", () => ({
  pendingPresence: jest.fn(),
  markPresenceDone: jest.fn(),
  removePresence: jest.fn(),
  markPresenceFailed: jest.fn(),
  bumpPresenceAttempts: jest.fn(),
}));

const mockedApi = attendanceApi as jest.Mocked<typeof attendanceApi>;
const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockedLoadToken = loadToken as jest.MockedFunction<typeof loadToken>;
const mockedPending = pendingPresence as jest.MockedFunction<typeof pendingPresence>;
const mockedDone = markPresenceDone as jest.MockedFunction<typeof markPresenceDone>;
const mockedRemove = removePresence as jest.MockedFunction<typeof removePresence>;
const mockedFailed = markPresenceFailed as jest.MockedFunction<typeof markPresenceFailed>;
const mockedBump = bumpPresenceAttempts as jest.MockedFunction<typeof bumpPresenceAttempts>;

const apiError = (status: number, detail = "nope") =>
  new ApiError("POST", "/api/attendance/presence", status, JSON.stringify({ detail }));

const crossing: QueuedPresence = {
  client_id: "c1",
  tech_id: "t1",
  shop_id: "default",
  kind: "arrive",
  device_time: "2026-06-03T04:00:00.000Z",
  lat: 24.86,
  lng: 67.0,
  accuracy_m: 10,
  is_mock_location: false,
  wifi_bssid: "AA:BB",
  wifi_ssid: "Shop",
  confirmed: false,
  done: false,
  created_at: "2026-06-03T04:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetToken.mockReturnValue("tok"); // token already hydrated by default
  mockedApi.recordPresence.mockResolvedValue({
    event_id: "evt-1",
    client_id: "c1",
    server_time: "2026-06-03T04:00:01Z",
    kind: "arrive",
    inside_geofence: true,
    distance_m: 5,
    deduped: false,
  });
  mockedDone.mockResolvedValue(undefined);
  mockedRemove.mockResolvedValue(undefined);
  mockedFailed.mockResolvedValue(undefined);
  mockedBump.mockResolvedValue(1);
});

it("posts each crossing, marks it done, and removes it", async () => {
  mockedPending.mockResolvedValue([crossing]);

  await syncPresence("t1");

  expect(mockedApi.recordPresence).toHaveBeenCalledWith(
    expect.objectContaining({
      client_id: "c1",
      kind: "arrive",
      wifi_bssid: "AA:BB",
      confirmed: false,
    }),
  );
  expect(mockedDone).toHaveBeenCalledWith("c1");
  expect(mockedRemove).toHaveBeenCalledWith(["c1"]);
});

it("hydrates the token from storage when the cache is cold (headless)", async () => {
  mockedGetToken.mockReturnValue(null);
  mockedPending.mockResolvedValue([crossing]);

  await syncPresence("t1");

  expect(mockedLoadToken).toHaveBeenCalled();
});

it("leaves a crossing queued if the POST fails", async () => {
  mockedPending.mockResolvedValue([crossing]);
  mockedApi.recordPresence.mockRejectedValueOnce(new Error("offline"));

  await syncPresence("t1");

  expect(mockedDone).not.toHaveBeenCalled();
  expect(mockedFailed).not.toHaveBeenCalled(); // a network error never parks
  expect(mockedRemove).toHaveBeenCalledWith([]); // nothing settled
});

it("parks a definitively-rejected crossing and drains the rest", async () => {
  const second: QueuedPresence = { ...crossing, client_id: "c2" };
  mockedPending.mockResolvedValue([crossing, second]);
  mockedApi.recordPresence.mockRejectedValueOnce(apiError(422, "bad crossing"));

  await syncPresence("t1");

  expect(mockedFailed).toHaveBeenCalledWith("c1", "bad crossing");
  expect(mockedApi.recordPresence).toHaveBeenCalledTimes(2); // continued to c2
  expect(mockedDone).toHaveBeenCalledWith("c2");
});

it("stops the drain on 401 without parking anything", async () => {
  const second: QueuedPresence = { ...crossing, client_id: "c2" };
  mockedPending.mockResolvedValue([crossing, second]);
  mockedApi.recordPresence.mockRejectedValueOnce(apiError(401));

  await syncPresence("t1");

  expect(mockedFailed).not.toHaveBeenCalled();
  expect(mockedApi.recordPresence).toHaveBeenCalledTimes(1); // broke out
});

it("parks a crossing that exhausts its retries on a repeated 5xx", async () => {
  mockedPending.mockResolvedValue([crossing]);
  mockedApi.recordPresence.mockRejectedValueOnce(apiError(500));
  mockedBump.mockResolvedValueOnce(5);

  await syncPresence("t1");

  expect(mockedBump).toHaveBeenCalledWith("c1");
  expect(mockedFailed).toHaveBeenCalledWith("c1", expect.stringContaining("gave up after 5"));
});

it("skips another technician's crossings (shared-device protection)", async () => {
  mockedPending.mockResolvedValue([{ ...crossing, tech_id: "t9" }]);

  await syncPresence("t1");

  expect(mockedApi.recordPresence).not.toHaveBeenCalled();
});

it("does nothing when no one is signed in", async () => {
  mockedPending.mockResolvedValue([crossing]);

  await syncPresence(null);

  expect(mockedApi.recordPresence).not.toHaveBeenCalled();
});
