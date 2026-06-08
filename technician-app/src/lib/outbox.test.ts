/** Outbox queue mechanics — AsyncStorage backed by an in-memory map. */

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

import { enqueue, loadOutbox, outboxCount, removeItem, type OutboxItem } from "./outbox";

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "completion:job-1",
  kind: "completion",
  jobId: "job-1",
  payload: { body: {} },
  createdAt: "2026-06-08T00:00:00Z",
  attempts: 0,
  ...over,
});

beforeEach(() => {
  mockStore = {};
});

describe("outbox queue", () => {
  it("enqueues and loads back", async () => {
    await enqueue(item());
    const all = await loadOutbox();
    expect(all).toHaveLength(1);
    expect(all[0]?.kind).toBe("completion");
  });

  it("upserts by id — last write wins for a stable-id kind", async () => {
    await enqueue(item({ payload: { body: { v: 1 } } }));
    await enqueue(item({ payload: { body: { v: 2 } } }));
    const all = await loadOutbox();
    expect(all).toHaveLength(1);
    expect((all[0]?.payload as { body: { v: number } }).body.v).toBe(2);
  });

  it("appends distinct ids (e.g. each payment)", async () => {
    await enqueue(item({ id: "pay-1", kind: "payment" }));
    await enqueue(item({ id: "pay-2", kind: "payment" }));
    expect(await outboxCount()).toBe(2);
  });

  it("removes by id", async () => {
    await enqueue(item({ id: "a" }));
    await enqueue(item({ id: "b" }));
    await removeItem("a");
    const all = await loadOutbox();
    expect(all.map((i) => i.id)).toEqual(["b"]);
  });
});
