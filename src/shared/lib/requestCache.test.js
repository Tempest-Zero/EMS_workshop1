import { beforeEach, describe, expect, it, vi } from "vitest";

import { _resetRequestCacheForTests, cached, invalidate } from "./requestCache";

describe("requestCache", () => {
  beforeEach(() => {
    _resetRequestCacheForTests();
    vi.restoreAllMocks();
  });

  it("serves the cached value within the TTL without re-calling", async () => {
    const fn = vi.fn(() => Promise.resolve({ n: 1 }));
    const a = await cached("k", fn, { ttlMs: 60_000 });
    const b = await cached("k", fn, { ttlMs: 60_000 });
    expect(a).toEqual({ n: 1 });
    expect(b).toBe(a);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers onto one in-flight request", async () => {
    let release;
    const fn = vi.fn(() => new Promise((r) => (release = r)));
    const p1 = cached("k", fn, { ttlMs: 60_000 });
    const p2 = cached("k", fn, { ttlMs: 60_000 });
    release(42);
    expect(await p1).toBe(42);
    expect(await p2).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("re-calls after the TTL has expired", async () => {
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);
    const fn = vi.fn(() => Promise.resolve("first"));
    await cached("k", fn, { ttlMs: 60_000 });
    now.mockReturnValue(1_000_000 + 61_000);
    fn.mockImplementation(() => Promise.resolve("second"));
    expect(await cached("k", fn, { ttlMs: 60_000 })).toBe("second");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("keys are independent", async () => {
    const fn = vi.fn((v) => () => Promise.resolve(v));
    expect(await cached("a", fn("A"), { ttlMs: 60_000 })).toBe("A");
    expect(await cached("b", fn("B"), { ttlMs: 60_000 })).toBe("B");
  });

  it("never caches a failure", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("boom")));
    await expect(cached("k", fn, { ttlMs: 60_000 })).rejects.toThrow("boom");
    fn.mockImplementation(() => Promise.resolve("ok"));
    expect(await cached("k", fn, { ttlMs: 60_000 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invalidate(key) forces the next call through", async () => {
    const fn = vi.fn(() => Promise.resolve(1));
    await cached("k", fn, { ttlMs: 60_000 });
    invalidate("k");
    await cached("k", fn, { ttlMs: 60_000 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
