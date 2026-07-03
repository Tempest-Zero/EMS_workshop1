/** Punch pipeline tests — capture primitives, queue, and sync all mocked. */

import { captureSelfie } from "./selfie";
import { enqueue } from "./queue";
import { getLocation } from "./location";
import { startDutyPings, stopDutyPings } from "./pingTracker";
import { getWifi } from "./wifi";
import { punch } from "./punch";
import { syncNow } from "./sync";

jest.mock("./queue", () => ({ enqueue: jest.fn() }));
jest.mock("./location", () => ({ getLocation: jest.fn() }));
jest.mock("./wifi", () => ({ getWifi: jest.fn() }));
jest.mock("./selfie", () => ({ captureSelfie: jest.fn() }));
jest.mock("./sync", () => ({ syncNow: jest.fn() }));
// Mocked so the test doesn't pull in the real tracker (task registration + OS
// location); we just assert the punch pipeline drives it.
jest.mock("./pingTracker", () => ({ startDutyPings: jest.fn(), stopDutyPings: jest.fn() }));
jest.mock("expo-crypto", () => ({ randomUUID: jest.fn(() => "uuid-1") }));

const mockedEnqueue = enqueue as jest.MockedFunction<typeof enqueue>;
const mockedLoc = getLocation as jest.MockedFunction<typeof getLocation>;
const mockedWifi = getWifi as jest.MockedFunction<typeof getWifi>;
const mockedSelfie = captureSelfie as jest.MockedFunction<typeof captureSelfie>;
const mockedSync = syncNow as jest.MockedFunction<typeof syncNow>;
const mockedStart = startDutyPings as jest.MockedFunction<typeof startDutyPings>;
const mockedStop = stopDutyPings as jest.MockedFunction<typeof stopDutyPings>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedLoc.mockResolvedValue({ lat: 24.86, lng: 67.0, accuracy_m: 12, is_mock_location: false });
  mockedWifi.mockResolvedValue({ wifi_bssid: "AA:BB", wifi_ssid: "Shop" });
  mockedSelfie.mockResolvedValue({
    uri: "file://doc/s.jpg",
    filename: "s.jpg",
    contentType: "image/jpeg",
  });
});

describe("punch", () => {
  it("captures evidence, enqueues instantly, and triggers sync", async () => {
    const item = await punch({ techId: "t1", kind: "clock_in" });

    expect(item.client_id).toBe("uuid-1");
    expect(item.kind).toBe("clock_in");
    expect(item.lat).toBe(24.86);
    expect(item.wifi_bssid).toBe("AA:BB");
    expect(item.selfie_uri).toBe("file://doc/s.jpg");
    expect(mockedEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "uuid-1", tech_id: "t1" }),
    );
    expect(mockedSync).toHaveBeenCalled();
    // Clock-in arms on-duty ping tracking (does not stop it).
    expect(mockedStart).toHaveBeenCalledWith("t1");
    expect(mockedStop).not.toHaveBeenCalled();
  });

  it("stops on-duty ping tracking on clock-out (the privacy hard-stop)", async () => {
    await punch({ techId: "t1", kind: "clock_out", withSelfie: false });

    expect(mockedStop).toHaveBeenCalledWith("t1");
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it("flags a mock-location punch and can skip the selfie", async () => {
    mockedLoc.mockResolvedValue({ lat: 0, lng: 0, accuracy_m: 5, is_mock_location: true });

    const item = await punch({ techId: "t1", kind: "clock_in", withSelfie: false });

    expect(item.is_mock_location).toBe(true);
    expect(item.selfie_uri).toBeNull();
    expect(mockedSelfie).not.toHaveBeenCalled();
  });
});
