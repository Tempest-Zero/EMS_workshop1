/** Queue tests — AsyncStorage replaced with an in-memory mock. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  enqueue,
  loadQueue,
  pendingPunches,
  removePunches,
  updatePunch,
  type QueuedPunch,
} from "./queue";

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((k: string) => Promise.resolve(store[k] ?? null)),
      setItem: jest.fn((k: string, v: string) => {
        store[k] = v;
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = {};
        return Promise.resolve();
      }),
    },
  };
});

const base: QueuedPunch = {
  client_id: "c1",
  tech_id: "t1",
  shop_id: "default",
  kind: "clock_in",
  device_time: "2026-06-03T04:00:00.000Z",
  lat: null,
  lng: null,
  accuracy_m: null,
  is_mock_location: false,
  wifi_bssid: null,
  wifi_ssid: null,
  selfie_uri: null,
  selfie_filename: null,
  selfie_content_type: null,
  server_event_id: null,
  selfie_done: false,
  done: false,
  created_at: "2026-06-03T04:00:00.000Z",
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("queue", () => {
  it("enqueues and loads a punch", async () => {
    await enqueue(base);
    const items = await loadQueue();
    expect(items).toHaveLength(1);
    expect(items[0]?.client_id).toBe("c1");
  });

  it("dedups on client_id", async () => {
    await enqueue(base);
    await enqueue({ ...base, kind: "clock_out" }); // same client_id
    expect(await loadQueue()).toHaveLength(1);
  });

  it("updates a punch by client_id", async () => {
    await enqueue(base);
    await updatePunch("c1", { server_event_id: "evt-1", done: true });
    const items = await loadQueue();
    expect(items[0]?.server_event_id).toBe("evt-1");
    expect(items[0]?.done).toBe(true);
  });

  it("pendingPunches excludes done", async () => {
    await enqueue(base);
    await enqueue({ ...base, client_id: "c2" });
    await updatePunch("c1", { done: true });
    const pending = await pendingPunches();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.client_id).toBe("c2");
  });

  it("removePunches drops the listed entries and keeps the rest", async () => {
    await enqueue(base);
    await enqueue({ ...base, client_id: "c2" });
    await enqueue({ ...base, client_id: "c3" });
    await removePunches(["c1", "c3"]);
    const items = await loadQueue();
    expect(items.map((i) => i.client_id)).toEqual(["c2"]);
  });

  it("does not lose a punch when two mutations race (lost-update lock)", async () => {
    // Unserialised, both read the same snapshot and the second write clobbers
    // the first — a punch silently vanishes.
    await Promise.all([enqueue(base), enqueue({ ...base, client_id: "c2" })]);
    expect((await loadQueue()).map((i) => i.client_id).sort()).toEqual(["c1", "c2"]);
  });

  it("keeps a concurrent enqueue while the sync prunes a settled punch", async () => {
    await enqueue({ ...base, client_id: "old", done: true });
    await Promise.all([removePunches(["old"]), enqueue({ ...base, client_id: "fresh" })]);
    expect((await loadQueue()).map((i) => i.client_id)).toEqual(["fresh"]);
  });
});
