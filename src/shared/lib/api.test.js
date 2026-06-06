import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiGet, apiSend, getToken, setToken, setUnauthorizedHandler } from "./api";

beforeEach(() => {
  setToken(null);
  setUnauthorizedHandler(null);
});

describe("shared api client", () => {
  it("attaches a bearer header when a token is set", async () => {
    setToken("abc123");
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    );
    await apiGet("/x");
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer abc123");
  });

  it("omits the auth header when no token is set", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
    );
    await apiSend("/x", "POST", { a: 1 });
    const init = globalThis.fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("clears the token and notifies the handler on a 401", async () => {
    setToken("abc123");
    const onUnauth = vi.fn();
    setUnauthorizedHandler(onUnauth);
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, text: () => Promise.resolve("nope") })
    );
    await expect(apiGet("/x")).rejects.toThrow(/failed \(401\)/);
    expect(getToken()).toBeNull();
    expect(onUnauth).toHaveBeenCalledOnce();
  });
});
