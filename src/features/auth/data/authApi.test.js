import { describe, it, expect, vi, beforeEach } from "vitest";
import { login, fetchTechnicians } from "./authApi";
import { getToken, setToken } from "@shared/lib/api";

beforeEach(() => setToken(null));

describe("authApi", () => {
  it("login posts the credentials and stores the returned token", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            token: "tok-1",
            technician: { id: "t1", name: "Imran", role: "manager" },
          }),
      })
    );

    const tech = await login("t1", "1234");

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ tech_id: "t1", pin: "1234" });
    expect(tech.id).toBe("t1");
    expect(getToken()).toBe("tok-1");
  });

  it("fetchTechnicians hits the public roster endpoint", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) })
    );
    await fetchTechnicians();
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/api/technicians");
  });
});
