/** Ping-queue tests — AsyncStorage replaced with an in-memory mock. */

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  enqueuePing,
  loadPingQueue,
  markPingsDone,
  MAX_UNSENT_PINGS,
  pendingPings,
  removePings,
  type QueuedPing,
} from "./pingQueue";

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

const KEY = "attendance.pings.queue.v1";
const BASE = 1_717_000_000_000; // epoch ms; +i seconds gives ascending created_at

function ping(client_id: string, over: Partial<QueuedPing> = {}): QueuedPing {
  return {
    client_id,
    tech_id: "t1",
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
    ...over,
  };
}

const at = (i: number) => new Date(BASE + i * 1000).toISOString();

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

it("enqueues and dedups on client_id", async () => {
  await enqueuePing(ping("a"));
  await enqueuePing(ping("a")); // duplicate — ignored
  await enqueuePing(ping("b"));
  expect((await loadPingQueue()).map((p) => p.client_id)).toEqual(["a", "b"]);
});

it("caps the unsent backlog, dropping the OLDEST unsent first", async () => {
  const seed = Array.from({ length: MAX_UNSENT_PINGS }, (_, i) =>
    ping(`c${i}`, { created_at: at(i) }),
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(seed));

  await enqueuePing(ping("c-new", { created_at: at(MAX_UNSENT_PINGS) }));

  const q = await loadPingQueue();
  expect(q.length).toBe(MAX_UNSENT_PINGS);
  expect(q.some((p) => p.client_id === "c0")).toBe(false); // oldest evicted
  expect(q.some((p) => p.client_id === "c-new")).toBe(true); // newest kept
});

it("does not count synced-but-unpruned rows against the cap", async () => {
  const unsent = Array.from({ length: MAX_UNSENT_PINGS }, (_, i) =>
    ping(`u${i}`, { created_at: at(i) }),
  );
  const done = [ping("d0", { done: true }), ping("d1", { done: true })];
  await AsyncStorage.setItem(KEY, JSON.stringify([...done, ...unsent]));

  await enqueuePing(ping("u-new", { created_at: at(MAX_UNSENT_PINGS) }));

  const q = await loadPingQueue();
  expect(q.some((p) => p.client_id === "u0")).toBe(false); // one oldest unsent dropped
  expect(q.some((p) => p.client_id === "d0")).toBe(true); // done rows untouched
  expect(q.some((p) => p.client_id === "d1")).toBe(true);
  expect(q.filter((p) => !p.done).length).toBe(MAX_UNSENT_PINGS);
});

it("marks done, lists pending, and removes", async () => {
  await enqueuePing(ping("a"));
  await enqueuePing(ping("b"));
  await markPingsDone(["a"]);
  expect((await pendingPings()).map((p) => p.client_id)).toEqual(["b"]);
  await removePings(["a"]);
  expect((await loadPingQueue()).map((p) => p.client_id)).toEqual(["b"]);
});
