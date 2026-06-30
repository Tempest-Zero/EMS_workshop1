/** Presence-sync tests — api, queue, and auth mocked (no network/storage). */

import { attendanceApi } from "../../lib/attendanceApi";
import { getToken, loadToken } from "../../lib/auth";
import {
  markPresenceDone,
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
}));

const mockedApi = attendanceApi as jest.Mocked<typeof attendanceApi>;
const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockedLoadToken = loadToken as jest.MockedFunction<typeof loadToken>;
const mockedPending = pendingPresence as jest.MockedFunction<typeof pendingPresence>;
const mockedDone = markPresenceDone as jest.MockedFunction<typeof markPresenceDone>;
const mockedRemove = removePresence as jest.MockedFunction<typeof removePresence>;

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
});

it("posts each crossing, marks it done, and removes it", async () => {
  mockedPending.mockResolvedValue([crossing]);

  await syncPresence("t1");

  expect(mockedApi.recordPresence).toHaveBeenCalledWith(
    expect.objectContaining({ client_id: "c1", kind: "arrive", wifi_bssid: "AA:BB" }),
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
  expect(mockedRemove).toHaveBeenCalledWith([]); // nothing settled
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
