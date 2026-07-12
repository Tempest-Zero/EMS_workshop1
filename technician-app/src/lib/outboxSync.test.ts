/**
 * sendOrQueue (online/offline/error routing) + flushOutbox (drain + replay) —
 * including the v2 classification matrix. Every branch here is a data-safety
 * guarantee: the v1 outbox silently deleted cash payments on a 502.
 */

import type { JobDetail } from "./jobsApi";
import type { OutboxItem } from "./outbox";

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

const mockNetFetch = jest.fn();
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: () => mockNetFetch() },
}));

const mockSubmitCompletion = jest.fn();
const mockLogPayment = jest.fn();
const mockTransition = jest.fn();
const mockAddNote = jest.fn();
jest.mock("./jobsApi", () => ({
  jobsApi: {
    submitCompletion: (...a: unknown[]) => mockSubmitCompletion(...a),
    logPayment: (...a: unknown[]) => mockLogPayment(...a),
    voidPayment: jest.fn(),
    negotiateBill: jest.fn(),
    recordLocation: jest.fn(),
    transition: (...a: unknown[]) => mockTransition(...a),
    addNote: (...a: unknown[]) => mockAddNote(...a),
  },
}));

import { ApiError } from "./api";
import { loadOutbox, outboxCounts, setOutboxPrincipal } from "./outbox";
import { flushOutbox, isOutboxPaused, resumeOutbox, sendOrQueue } from "./outboxSync";

const detail = { id: "job-1" } as unknown as JobDetail;
const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "completion:job-1",
  kind: "completion",
  jobId: "job-1",
  payload: { body: { x: 1 } },
  createdAt: "t",
  attempts: 0,
  techId: "t1",
  status: "queued",
  ...over,
});

const apiError = (status: number, body = "") => new ApiError("POST", "/x", status, body);

beforeEach(async () => {
  mockStore = {};
  mockNetFetch.mockReset();
  mockSubmitCompletion.mockReset();
  mockLogPayment.mockReset();
  mockTransition.mockReset();
  mockAddNote.mockReset();
  setOutboxPrincipal("t1");
  await resumeOutbox("t1"); // clears a pause left by a previous test
});

describe("sendOrQueue", () => {
  it("online — sends and returns the detail, nothing queued", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item(), () => Promise.resolve(detail));
    expect(r).toBe(detail);
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("offline — queues and returns null (never calls the API)", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: false });
    const call = jest.fn();
    const r = await sendOrQueue(item(), () => {
      call();
      return Promise.resolve(detail);
    });
    expect(r).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("network error while online — queues", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item(), () => Promise.reject(new Error("Network request failed")));
    expect(r).toBeNull();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("transient server error (502 mid-deploy) — queues instead of erroring", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item(), () => Promise.reject(apiError(502, "bad gateway")));
    expect(r).toBeNull();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("definitive 4xx on a live tap — rethrows, not queued", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    await expect(sendOrQueue(item(), () => Promise.reject(apiError(400, "bad")))).rejects.toThrow(
      /400/,
    );
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("401 on a live tap — rethrows (session ended), not queued", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    await expect(sendOrQueue(item(), () => Promise.reject(apiError(401)))).rejects.toThrow(/401/);
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("online success supersedes an earlier queued copy of the same write", async () => {
    // Offline-queue completion v1, then reconnect and send v2 live. The live
    // write is authoritative — v1 must not linger to be replayed over it.
    mockNetFetch.mockResolvedValue({ isConnected: false });
    await sendOrQueue(item({ payload: { body: { v: 1 } } }), () => Promise.resolve(detail));
    expect((await outboxCounts()).queued).toBe(1);

    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item({ payload: { body: { v: 2 } } }), () =>
      Promise.resolve(detail),
    );
    expect(r).toBe(detail);
    expect((await outboxCounts()).queued).toBe(0); // v1 dropped — nothing to replay
  });
});

describe("flushOutbox classification", () => {
  const queueOne = async (over: Partial<OutboxItem> = {}) => {
    mockNetFetch.mockResolvedValue({ isConnected: false });
    await sendOrQueue(item(over), () => Promise.resolve(detail));
  };

  it("drains a queued item via the matching API call", async () => {
    await queueOne();
    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox();
    expect(mockSubmitCompletion).toHaveBeenCalledWith("job-1", { x: 1 });
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("keeps the item queued on a connectivity failure", async () => {
    await queueOne();
    mockSubmitCompletion.mockRejectedValue(new Error("Network request failed"));
    await flushOutbox();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("keeps the item queued on a 503 (the v1 silent-drop bug)", async () => {
    await queueOne();
    mockSubmitCompletion.mockRejectedValue(apiError(503, "deploying"));
    await flushOutbox();
    expect((await outboxCounts()).queued).toBe(1);
    expect((await loadOutbox())[0]?.attempts).toBe(1);
  });

  it("keeps the item queued on a 429", async () => {
    await queueOne();
    mockSubmitCompletion.mockRejectedValue(apiError(429, "slow down"));
    await flushOutbox();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("moves a definitively-rejected item to the visible failed list — never deletes", async () => {
    await queueOne({ id: "pay-1", kind: "payment", payload: { amountPaisa: 1, method: "cash", clientId: "c" } });
    mockLogPayment.mockRejectedValue(apiError(409, '{"detail":"job is closed"}'));
    await flushOutbox();
    const all = await loadOutbox();
    expect(all).toHaveLength(1); // still stored
    expect(all[0]?.status).toBe("failed");
    expect(all[0]?.failedReason).toBe("job is closed");
  });

  it("a failed item does not block the items behind it", async () => {
    await queueOne({ id: "bad", kind: "payment", payload: { amountPaisa: 1, method: "cash", clientId: "c" } });
    await queueOne({ id: "good", kind: "completion" });
    mockLogPayment.mockRejectedValue(apiError(422, "no"));
    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox();
    expect(await outboxCounts()).toEqual({ queued: 0, failed: 1 });
    expect(mockSubmitCompletion).toHaveBeenCalled();
  });

  it("401 pauses the queue — items intact, later flushes no-op, resume re-arms", async () => {
    await queueOne({ id: "a" });
    await queueOne({ id: "b", kind: "payment", payload: { amountPaisa: 1, method: "cash", clientId: "c" } });
    mockSubmitCompletion.mockRejectedValue(apiError(401));
    await flushOutbox();
    expect(isOutboxPaused()).toBe(true);
    expect((await outboxCounts()).queued).toBe(2); // nothing dropped

    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox(); // paused → must not send
    expect((await outboxCounts()).queued).toBe(2);

    await resumeOutbox("t1");
    mockLogPayment.mockResolvedValue(detail);
    await flushOutbox();
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("never flushes another technician's writes (shared device)", async () => {
    await queueOne({ id: "theirs", techId: "t2" });
    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox(); // signed in as t1
    expect(mockSubmitCompletion).not.toHaveBeenCalled();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("does nothing when nobody is signed in", async () => {
    await queueOne();
    setOutboxPrincipal(null);
    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox();
    expect(mockSubmitCompletion).not.toHaveBeenCalled();
    expect((await outboxCounts()).queued).toBe(1);
  });

  it("replays ready and note kinds via transition/addNote", async () => {
    await queueOne({ id: "ready:job-1", kind: "ready", payload: {} });
    await queueOne({ id: "note:n1", kind: "note", payload: { text: "left a note" } });
    mockTransition.mockResolvedValue(detail);
    mockAddNote.mockResolvedValue(detail);
    await flushOutbox();
    expect(mockTransition).toHaveBeenCalledWith("job-1", "ready");
    expect(mockAddNote).toHaveBeenCalledWith("job-1", "left a note");
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("replays a queued unreachable transition (wait) with its reason", async () => {
    await queueOne({
      id: "transition:wait:job-1",
      kind: "transition",
      payload: { action: "wait", reason: "gate locked" },
    });
    mockTransition.mockResolvedValue(detail);
    await flushOutbox();
    expect(mockTransition).toHaveBeenCalledWith("job-1", "wait", "gate locked", {
      preferred_date: undefined,
      time_window: undefined,
    });
    expect((await outboxCounts()).queued).toBe(0);
  });

  it("replays a queued reschedule transition with date + window", async () => {
    await queueOne({
      id: "transition:reschedule:job-1",
      kind: "transition",
      payload: { action: "reschedule", preferred_date: "2026-07-20", time_window: "July 20 · Morning" },
    });
    mockTransition.mockResolvedValue(detail);
    await flushOutbox();
    expect(mockTransition).toHaveBeenCalledWith("job-1", "reschedule", undefined, {
      preferred_date: "2026-07-20",
      time_window: "July 20 · Morning",
    });
    expect((await outboxCounts()).queued).toBe(0);
  });

  // ── Dead-letter: a poison server error must not block the queue forever ──────
  it("dead-letters a poison 5xx item after the attempt cap, never deleting it", async () => {
    await queueOne();
    mockSubmitCompletion.mockRejectedValue(apiError(500, "always boom"));
    for (let i = 0; i < 5; i++) await flushOutbox();
    const all = await loadOutbox();
    expect(all).toHaveLength(1); // parked, never dropped
    expect(all[0]?.status).toBe("failed");
    expect(all[0]?.failedReason).toMatch(/gave up after 5 attempts/);
    expect(await outboxCounts()).toEqual({ queued: 0, failed: 1 });
  });

  it("a persistently-failing head item stops blocking the queue once it dead-letters", async () => {
    await queueOne({ id: "poison", kind: "completion" });
    await queueOne({
      id: "good",
      kind: "payment",
      payload: { amountPaisa: 1, method: "cash", clientId: "c" },
    });
    mockSubmitCompletion.mockRejectedValue(apiError(500, "boom")); // the poison completion
    mockLogPayment.mockResolvedValue(detail); // the payment queued behind it
    for (let i = 0; i < 5; i++) await flushOutbox();
    expect(await outboxCounts()).toEqual({ queued: 0, failed: 1 });
    expect(mockLogPayment).toHaveBeenCalled(); // the good write got through
  });

  it("connectivity failures never count toward the dead-letter cap", async () => {
    await queueOne();
    mockSubmitCompletion.mockRejectedValue(new Error("Network request failed"));
    for (let i = 0; i < 8; i++) await flushOutbox();
    const all = await loadOutbox();
    expect(all[0]?.status).toBe("queued"); // still retrying, never parked
    expect(all[0]?.attempts).toBe(0); // offline doesn't increment attempts
  });
});
