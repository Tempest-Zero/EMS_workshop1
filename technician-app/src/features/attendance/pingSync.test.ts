/** Ping-sync tests — api, queue, and auth mocked (no network/storage). */

import { attendanceApi } from "../../lib/attendanceApi";
import { getToken, loadToken } from "../../lib/auth";
import { markPingsDone, pendingPings, removePings, type QueuedPing } from "./pingQueue";
import { syncPings } from "./pingSync";

jest.mock("../../lib/attendanceApi", () => ({
  attendanceApi: { recordPings: jest.fn() },
}));
jest.mock("../../lib/auth", () => ({
  getToken: jest.fn(),
  loadToken: jest.fn(),
}));
jest.mock("./pingQueue", () => ({
  pendingPings: jest.fn(),
  markPingsDone: jest.fn(),
  removePings: jest.fn(),
}));

const mockedApi = attendanceApi as jest.Mocked<typeof attendanceApi>;
const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockedLoadToken = loadToken as jest.MockedFunction<typeof loadToken>;
const mockedPending = pendingPings as jest.MockedFunction<typeof pendingPings>;
const mockedDone = markPingsDone as jest.MockedFunction<typeof markPingsDone>;
const mockedRemove = removePings as jest.MockedFunction<typeof removePings>;

function ping(client_id: string, tech_id = "t1"): QueuedPing {
  return {
    client_id,
    tech_id,
    shop_id: "default",
    captured_at: "2026-06-03T04:00:00.000Z",
    lat: 24.86,
    lng: 67.0,
    accuracy_m: 10,
    is_mock_location: false,
    wifi_bssid: null,
    wifi_ssid: null,
    done: false,
    created_at: "2026-06-03T04:00:00.000Z",
  };
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`);

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetToken.mockReturnValue("tok"); // token already hydrated by default
  mockedApi.recordPings.mockResolvedValue({ accepted: 1, deduped: 0, ping_interval_minutes: 5 });
  mockedDone.mockResolvedValue(undefined);
  mockedRemove.mockResolvedValue(undefined);
});

it("posts pending pings in one batch, marks them done, and removes them", async () => {
  mockedPending.mockResolvedValue([ping("a"), ping("b")]);

  await syncPings("t1");

  expect(mockedApi.recordPings).toHaveBeenCalledTimes(1);
  expect(mockedApi.recordPings).toHaveBeenCalledWith([
    expect.objectContaining({ client_id: "a" }),
    expect.objectContaining({ client_id: "b" }),
  ]);
  expect(mockedRemove).toHaveBeenCalledWith(["a", "b"]);
});

it("skips another technician's pings (shared-device protection)", async () => {
  mockedPending.mockResolvedValue([ping("a", "t1"), ping("x", "t9")]);

  await syncPings("t1");

  const sent = mockedApi.recordPings.mock.calls[0]?.[0] ?? [];
  expect(sent.map((p) => p.client_id)).toEqual(["a"]);
});

it("drains in batches of at most 100", async () => {
  mockedPending.mockResolvedValue(ids(150).map((c) => ping(c)));

  await syncPings("t1");

  expect(mockedApi.recordPings).toHaveBeenCalledTimes(2);
  expect(mockedApi.recordPings.mock.calls[0]?.[0]).toHaveLength(100);
  expect(mockedApi.recordPings.mock.calls[1]?.[0]).toHaveLength(50);
  expect(mockedRemove).toHaveBeenCalledWith(ids(150));
});

it("keeps a failed batch (and everything after it) queued", async () => {
  mockedPending.mockResolvedValue(ids(150).map((c) => ping(c)));
  mockedApi.recordPings
    .mockResolvedValueOnce({ accepted: 100, deduped: 0, ping_interval_minutes: 5 }) // batch 1 ok
    .mockRejectedValueOnce(new Error("offline")); // batch 2 fails → stop draining

  await syncPings("t1");

  expect(mockedApi.recordPings).toHaveBeenCalledTimes(2);
  expect(mockedDone).toHaveBeenCalledTimes(1); // only the first batch settled
  expect(mockedRemove).toHaveBeenCalledWith(ids(100)); // the rest stay queued
});

it("hydrates the token from storage when the cache is cold (headless)", async () => {
  mockedGetToken.mockReturnValue(null);
  mockedPending.mockResolvedValue([ping("a")]);

  await syncPings("t1");

  expect(mockedLoadToken).toHaveBeenCalled();
});

it("does nothing when no one is signed in", async () => {
  mockedPending.mockResolvedValue([ping("a")]);

  await syncPings(null);

  expect(mockedApi.recordPings).not.toHaveBeenCalled();
});
