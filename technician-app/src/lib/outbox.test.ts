/** Outbox v2 queue mechanics — AsyncStorage backed by an in-memory map. */

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

import {
  adoptLegacyItems,
  enqueue,
  itemsForJob,
  loadOutbox,
  makeItem,
  markFailed,
  outboxCounts,
  removeItem,
  retryItem,
  setOutboxPrincipal,
  type OutboxItem,
} from "./outbox";

const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "completion:job-1",
  kind: "completion",
  jobId: "job-1",
  payload: { body: {} },
  createdAt: "2026-06-08T00:00:00Z",
  attempts: 0,
  techId: "t1",
  status: "queued",
  ...over,
});

beforeEach(() => {
  mockStore = {};
  setOutboxPrincipal("t1");
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
    expect((await outboxCounts()).queued).toBe(2);
  });

  it("removes by id", async () => {
    await enqueue(item({ id: "a" }));
    await enqueue(item({ id: "b" }));
    await removeItem("a");
    const all = await loadOutbox();
    expect(all.map((i) => i.id)).toEqual(["b"]);
  });

  it("makeItem stamps the signed-in tech and a queued status", () => {
    setOutboxPrincipal("t3");
    const i = makeItem({ id: "x", kind: "note", jobId: "j", payload: { text: "hi" } });
    expect(i.techId).toBe("t3");
    expect(i.status).toBe("queued");
    expect(i.attempts).toBe(0);
  });
});

describe("failed list", () => {
  it("markFailed parks the item (still stored, counted separately)", async () => {
    await enqueue(item({ id: "pay-1", kind: "payment" }));
    await markFailed("pay-1", "job is closed");
    const all = await loadOutbox();
    expect(all).toHaveLength(1); // NEVER deleted
    expect(all[0]?.status).toBe("failed");
    expect(all[0]?.failedReason).toBe("job is closed");
    expect(await outboxCounts()).toEqual({ queued: 0, failed: 1 });
  });

  it("retryItem re-queues with a fresh attempt count", async () => {
    await enqueue(item({ id: "pay-1", kind: "payment", attempts: 7 }));
    await markFailed("pay-1", "boom");
    await retryItem("pay-1");
    const all = await loadOutbox();
    expect(all[0]?.status).toBe("queued");
    expect(all[0]?.attempts).toBe(0);
    expect(all[0]?.failedReason).toBeUndefined();
  });

  it("itemsForJob returns only that job's items", async () => {
    await enqueue(item({ id: "a", jobId: "job-1" }));
    await enqueue(item({ id: "b", jobId: "job-2" }));
    const got = await itemsForJob("job-1");
    expect(got.map((i) => i.id)).toEqual(["a"]);
  });
});

describe("v1 → v2 migration (must never lose a record)", () => {
  it("upgrades v1 items in place: untagged tech, queued status", async () => {
    mockStore["jobs.outbox.v1"] = JSON.stringify([
      {
        id: "pay-legacy",
        kind: "payment",
        jobId: "job-9",
        payload: { amountPaisa: 500000, method: "cash", clientId: "c1" },
        createdAt: "2026-06-01T00:00:00Z",
        attempts: 2,
      },
    ]);
    const all = await loadOutbox();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("pay-legacy");
    expect(all[0]?.techId).toBeNull();
    expect(all[0]?.status).toBe("queued");
    // v1 store is consumed; v2 now holds the record.
    expect(mockStore["jobs.outbox.v1"]).toBeUndefined();
    expect(mockStore["jobs.outbox.v2"]).toContain("pay-legacy");
  });

  it("merges v1 into an existing v2 store without overwriting v2 ids", async () => {
    await enqueue(item({ id: "shared-id", payload: { body: { from: "v2" } } }));
    mockStore["jobs.outbox.v1"] = JSON.stringify([
      { id: "shared-id", kind: "completion", jobId: "job-1", payload: { body: { from: "v1" } }, createdAt: "t", attempts: 0 },
      { id: "only-v1", kind: "payment", jobId: "job-1", payload: {}, createdAt: "t", attempts: 0 },
    ]);
    const all = await loadOutbox();
    expect(all).toHaveLength(2);
    const shared = all.find((i) => i.id === "shared-id");
    expect((shared?.payload as { body: { from: string } }).body.from).toBe("v2");
  });

  it("preserves an unparseable v1 store at a backup key instead of discarding it", async () => {
    mockStore["jobs.outbox.v1"] = "{corrupt json!!";
    const all = await loadOutbox();
    expect(all).toHaveLength(0);
    expect(mockStore["jobs.outbox.v1.corrupt"]).toBe("{corrupt json!!");
  });

  it("adoptLegacyItems stamps null-tagged items with the session tech", async () => {
    mockStore["jobs.outbox.v1"] = JSON.stringify([
      { id: "legacy", kind: "payment", jobId: "j", payload: {}, createdAt: "t", attempts: 0 },
    ]);
    await loadOutbox(); // migrate
    await adoptLegacyItems("t2");
    const all = await loadOutbox();
    expect(all[0]?.techId).toBe("t2");
  });
});
