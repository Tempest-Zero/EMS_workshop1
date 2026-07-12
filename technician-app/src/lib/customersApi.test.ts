/** customersApi client tests — fetch mocked (mirrors jobsApi.test.ts). */

import { customersApi } from "./customersApi";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
  },
}));

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

describe("customersApi.lookup", () => {
  it("GETs the lookup endpoint with the phone url-encoded", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: "c1", full_name: "Ayesha" }),
    });
    const found = await customersApi.lookup("+92 300 1234567");
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain("/api/customers/lookup?phone=");
    expect(url).toContain(encodeURIComponent("+92 300 1234567"));
    expect(init?.method ?? "GET").toBe("GET");
    expect(found).toEqual({ id: "c1", full_name: "Ayesha" });
  });

  it("passes a null body through as 'no match' (never throws)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(null),
    });
    await expect(customersApi.lookup("0300-0000000")).resolves.toBeNull();
  });
});
