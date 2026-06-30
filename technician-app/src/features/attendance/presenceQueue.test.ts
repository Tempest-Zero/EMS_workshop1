/** Presence-queue tests — AsyncStorage replaced with an in-memory mock. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  enqueuePresence,
  loadPresenceQueue,
  markPresenceDone,
  pendingPresence,
  removePresence,
  type QueuedPresence,
} from "./presenceQueue";

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

const base: QueuedPresence = {
  client_id: "c1",
  tech_id: "t1",
  shop_id: "default",
  kind: "arrive",
  device_time: "2026-06-03T04:00:00.000Z",
  lat: 24.86,
  lng: 67.0,
  accuracy_m: 10,
  is_mock_location: false,
  wifi_bssid: null,
  wifi_ssid: null,
  done: false,
  created_at: "2026-06-03T04:00:00.000Z",
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

it("enqueues a crossing and reads it back", async () => {
  await enqueuePresence(base);
  expect(await loadPresenceQueue()).toHaveLength(1);
  expect(await pendingPresence()).toHaveLength(1);
});

it("dedups a repeat client_id locally", async () => {
  await enqueuePresence(base);
  await enqueuePresence({ ...base, kind: "depart" }); // same client_id
  const q = await loadPresenceQueue();
  expect(q).toHaveLength(1);
  expect(q[0]?.kind).toBe("arrive"); // first writer wins
});

it("marks a crossing done so it drops out of pending", async () => {
  await enqueuePresence(base);
  await markPresenceDone("c1");
  expect(await pendingPresence()).toHaveLength(0);
  expect(await loadPresenceQueue()).toHaveLength(1); // still there until removed
});

it("removes settled crossings", async () => {
  await enqueuePresence(base);
  await enqueuePresence({ ...base, client_id: "c2" });
  await removePresence(["c1"]);
  const q = await loadPresenceQueue();
  expect(q.map((i) => i.client_id)).toEqual(["c2"]);
});

it("serialises interleaved writes without dropping one (mutex)", async () => {
  await Promise.all([
    enqueuePresence(base),
    enqueuePresence({ ...base, client_id: "c2" }),
    enqueuePresence({ ...base, client_id: "c3" }),
  ]);
  expect(await loadPresenceQueue()).toHaveLength(3);
});
