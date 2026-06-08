/** sendOrQueue (online/offline/error routing) + flushOutbox (drain + replay). */

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
jest.mock("./jobsApi", () => ({
  jobsApi: {
    submitCompletion: (...a: unknown[]) => mockSubmitCompletion(...a),
    logPayment: (...a: unknown[]) => mockLogPayment(...a),
    voidPayment: jest.fn(),
    negotiateBill: jest.fn(),
    recordLocation: jest.fn(),
  },
}));

import { outboxCount } from "./outbox";
import { flushOutbox, sendOrQueue } from "./outboxSync";

const detail = { id: "job-1" } as unknown as JobDetail;
const item = (over: Partial<OutboxItem> = {}): OutboxItem => ({
  id: "completion:job-1",
  kind: "completion",
  jobId: "job-1",
  payload: { body: { x: 1 } },
  createdAt: "t",
  attempts: 0,
  ...over,
});

beforeEach(() => {
  mockStore = {};
  mockNetFetch.mockReset();
  mockSubmitCompletion.mockReset();
  mockLogPayment.mockReset();
});

describe("sendOrQueue", () => {
  it("online — sends and returns the detail, nothing queued", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item(), () => Promise.resolve(detail));
    expect(r).toBe(detail);
    expect(await outboxCount()).toBe(0);
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
    expect(await outboxCount()).toBe(1);
  });

  it("network error while online — queues", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    const r = await sendOrQueue(item(), () => Promise.reject(new Error("Network request failed")));
    expect(r).toBeNull();
    expect(await outboxCount()).toBe(1);
  });

  it("server (4xx) error — rethrows, not queued", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: true });
    await expect(
      sendOrQueue(item(), () => Promise.reject(new Error("POST /x failed (400): bad"))),
    ).rejects.toThrow(/400/);
    expect(await outboxCount()).toBe(0);
  });
});

describe("flushOutbox", () => {
  it("drains a queued item via the matching API call", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: false });
    await sendOrQueue(item(), () => Promise.resolve(detail)); // queued (offline)

    mockSubmitCompletion.mockResolvedValue(detail);
    await flushOutbox();

    expect(mockSubmitCompletion).toHaveBeenCalledWith("job-1", { x: 1 });
    expect(await outboxCount()).toBe(0);
  });

  it("keeps the item queued on a connectivity failure", async () => {
    mockNetFetch.mockResolvedValue({ isConnected: false });
    await sendOrQueue(item(), () => Promise.resolve(detail));

    mockSubmitCompletion.mockRejectedValue(new Error("Network request failed"));
    await flushOutbox();

    expect(await outboxCount()).toBe(1);
  });
});
