/** Sync tests — api, queue, and expo-file-system mocked (no network/phone). */

import * as FileSystem from "expo-file-system";

import { attendanceApi } from "../../lib/attendanceApi";
import { loadQueue, pendingPunches, removePunches, updatePunch, type QueuedPunch } from "./queue";
import { pruneSettled, syncNow } from "./sync";

jest.mock("../../lib/attendanceApi", () => ({
  attendanceApi: { recordPunch: jest.fn(), completeSelfie: jest.fn() },
}));
jest.mock("./queue", () => ({
  pendingPunches: jest.fn(),
  updatePunch: jest.fn(),
  loadQueue: jest.fn(),
  removePunches: jest.fn(),
}));
jest.mock("expo-file-system", () => ({
  uploadAsync: jest.fn(),
  getInfoAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

const mockedApi = attendanceApi as jest.Mocked<typeof attendanceApi>;
const mockedPending = pendingPunches as jest.MockedFunction<typeof pendingPunches>;
const mockedUpdate = updatePunch as jest.MockedFunction<typeof updatePunch>;
const mockedLoad = loadQueue as jest.MockedFunction<typeof loadQueue>;
const mockedRemove = removePunches as jest.MockedFunction<typeof removePunches>;
const mockedFs = FileSystem as jest.Mocked<typeof FileSystem>;

const withSelfie: QueuedPunch = {
  client_id: "c1",
  tech_id: "t1",
  shop_id: "default",
  kind: "clock_in",
  device_time: "2026-06-03T04:00:00.000Z",
  lat: 24.86,
  lng: 67.0,
  accuracy_m: 10,
  is_mock_location: false,
  wifi_bssid: "AA:BB",
  wifi_ssid: "Shop",
  selfie_uri: "file://doc/selfie.jpg",
  selfie_filename: "selfie.jpg",
  selfie_content_type: "image/jpeg",
  server_event_id: null,
  selfie_done: false,
  done: false,
  created_at: "2026-06-03T04:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.recordPunch.mockResolvedValue({
    event_id: "evt-1",
    client_id: "c1",
    server_time: "2026-06-03T04:00:01Z",
    inside_geofence: true,
    distance_m: 5,
    is_mock_location: false,
    drift_seconds: 1,
    drift_flagged: false,
    wifi_match: true,
    selfie: { signed_url: "https://r2/up", storage_path: "attendance/x.jpg", expires_in: 600 },
    deduped: false,
  });
  mockedApi.completeSelfie.mockResolvedValue({} as never);
  (mockedFs.uploadAsync as unknown as jest.Mock).mockResolvedValue({
    status: 200,
    headers: {},
    body: "",
  });
  (mockedFs.getInfoAsync as unknown as jest.Mock).mockResolvedValue({
    exists: true,
    size: 4321,
    uri: "file://doc/selfie.jpg",
  });
  (mockedFs.deleteAsync as unknown as jest.Mock).mockResolvedValue(undefined);
  mockedLoad.mockResolvedValue([]);
  mockedRemove.mockResolvedValue(undefined);
});

describe("syncNow", () => {
  it("records the punch, uploads the selfie, and marks it done", async () => {
    mockedPending.mockResolvedValue([withSelfie]);

    await syncNow("t1");

    expect(mockedApi.recordPunch).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "c1", wifi_bssid: "AA:BB" }),
    );
    expect(mockedFs.uploadAsync).toHaveBeenCalledWith(
      "https://r2/up",
      "file://doc/selfie.jpg",
      expect.objectContaining({ httpMethod: "PUT" }),
    );
    expect(mockedApi.completeSelfie).toHaveBeenCalledWith("evt-1", "t1", { size_bytes: 4321 });
    expect(mockedUpdate).toHaveBeenCalledWith("c1", { server_event_id: "evt-1" });
    expect(mockedUpdate).toHaveBeenCalledWith("c1", { selfie_done: true });
    expect(mockedUpdate).toHaveBeenCalledWith("c1", { done: true });
  });

  it("marks a selfie-less punch done without uploading", async () => {
    mockedPending.mockResolvedValue([
      { ...withSelfie, selfie_uri: null, selfie_filename: null, selfie_content_type: null },
    ]);

    await syncNow("t1");

    expect(mockedFs.uploadAsync).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledWith("c1", { done: true });
  });

  it("leaves the punch queued if recording fails", async () => {
    mockedPending.mockResolvedValue([withSelfie]);
    mockedApi.recordPunch.mockRejectedValueOnce(new Error("offline"));

    await syncNow("t1");

    expect(mockedUpdate).not.toHaveBeenCalledWith("c1", { done: true });
  });

  it("skips another technician's queued punches (shared-device protection)", async () => {
    // The backend would 403 them under this session; they wait for their owner.
    mockedPending.mockResolvedValue([{ ...withSelfie, tech_id: "t9" }]);

    await syncNow("t1");

    expect(mockedApi.recordPunch).not.toHaveBeenCalled();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("does nothing when no one is signed in", async () => {
    mockedPending.mockResolvedValue([withSelfie]);

    await syncNow(null);

    expect(mockedApi.recordPunch).not.toHaveBeenCalled();
  });

  it("prunes settled punches and deletes their selfie files", async () => {
    mockedPending.mockResolvedValue([]);
    mockedLoad.mockResolvedValue([
      { ...withSelfie, done: true, selfie_done: true },
      { ...withSelfie, client_id: "c2", tech_id: "t9", done: true, selfie_uri: null },
      { ...withSelfie, client_id: "c3" }, // still pending — must stay
    ]);

    await syncNow("t1");

    // The settled selfie's local file is deleted; settled entries (any tech's)
    // are removed; the pending one is untouched.
    expect(mockedFs.deleteAsync).toHaveBeenCalledWith("file://doc/selfie.jpg", {
      idempotent: true,
    });
    expect(mockedRemove).toHaveBeenCalledWith(["c1", "c2"]);
  });

  it("keeps a settled entry whose selfie file could not be deleted", async () => {
    mockedLoad.mockResolvedValue([
      { ...withSelfie, done: true },
      { ...withSelfie, client_id: "c2", done: true, selfie_uri: null },
    ]);
    (mockedFs.deleteAsync as unknown as jest.Mock).mockRejectedValueOnce(new Error("io"));

    await pruneSettled();

    // c1's file delete failed → its entry survives for the next sweep.
    expect(mockedRemove).toHaveBeenCalledWith(["c2"]);
  });

  it("settles a punch whose selfie the server already considers closed", async () => {
    // A re-synced punch whose selfie was rejected (e.g. oversized): the server
    // returns no upload URL. The punch must settle, not retry forever.
    mockedPending.mockResolvedValue([withSelfie]);
    mockedApi.recordPunch.mockResolvedValueOnce({
      event_id: "evt-1",
      client_id: "c1",
      server_time: "2026-06-03T04:00:01Z",
      inside_geofence: true,
      distance_m: 5,
      is_mock_location: false,
      drift_seconds: 1,
      drift_flagged: false,
      wifi_match: true,
      selfie: null,
      deduped: true,
    });

    await syncNow("t1");

    expect(mockedFs.uploadAsync).not.toHaveBeenCalled();
    expect(mockedUpdate).toHaveBeenCalledWith("c1", { done: true });
  });
});
