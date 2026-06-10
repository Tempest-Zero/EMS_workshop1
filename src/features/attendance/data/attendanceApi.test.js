import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAdjustment,
  fetchAdjustments,
  fetchBoard,
  fetchGeofence,
  fetchPayrollExports,
  fetchGrid,
  fetchShift,
  fetchTechDays,
  saveGeofence,
  saveShift,
} from "./attendanceApi";

function mockOk() {
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) })
  );
}

describe("attendanceApi", () => {
  beforeEach(() => {
    mockOk();
  });

  it("fetchBoard passes shop_id and each tech id", async () => {
    await fetchBoard(["t1", "t2"]);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/board?");
    expect(url).toContain("shop_id=default");
    expect(url).toContain("tech_ids=t1");
    expect(url).toContain("tech_ids=t2");
  });

  it("fetchGrid passes the month", async () => {
    await fetchGrid("2026-06", ["t1"]);
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/grid?");
    expect(url).toContain("month=2026-06");
    expect(url).toContain("tech_ids=t1");
  });

  it("fetchTechDays builds the path and date range", async () => {
    await fetchTechDays("t3", "2026-06-01", "2026-06-04");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/techs/t3/days?");
    expect(url).toContain("start=2026-06-01");
    expect(url).toContain("end=2026-06-04");
  });

  it("fetchAdjustments passes the tech id", async () => {
    await fetchAdjustments("t2");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/adjustments?");
    expect(url).toContain("tech_id=t2");
  });

  it("createAdjustment posts the body with shop_id merged", async () => {
    await createAdjustment({
      tech_id: "t1",
      kind: "clock_out",
      server_time: "2026-06-04T13:00:00.000Z",
      reason: "forgot",
      manager_id: "m1",
    });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/attendance/adjustments");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.shop_id).toBe("default");
    expect(body.tech_id).toBe("t1");
    expect(body.reason).toBe("forgot");
  });

  it("fetchGeofence passes shop_id", async () => {
    await fetchGeofence();
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/geofences?shop_id=default");
  });

  it("saveGeofence PUTs the geofence body", async () => {
    await saveGeofence({
      name: "Workshop",
      center_lat: 33.65564,
      center_lng: 72.8543,
      radius_m: 80,
      is_active: true,
      wifi_bssids: null,
    });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/attendance/geofences?shop_id=default");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.center_lat).toBe(33.65564);
    expect(body.radius_m).toBe(80);
  });

  it("fetchShift builds the tech path with shop_id", async () => {
    await fetchShift("t2");
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/shifts/t2?shop_id=default");
  });

  it("saveShift PUTs the shift body", async () => {
    await saveShift("t3", {
      start_local: "09:00:00",
      end_local: "18:00:00",
      working_days: "1111110",
      grace_minutes: 10,
      timezone: "Asia/Karachi",
    });
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain("/api/attendance/shifts/t3?shop_id=default");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.working_days).toBe("1111110");
    expect(body.grace_minutes).toBe(10);
  });

  it("fetchPayrollExports passes shop_id", async () => {
    await fetchPayrollExports();
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain("/api/attendance/payroll/exports?shop_id=default");
  });

  it("throws on a non-ok response", async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("boom") })
    );
    await expect(fetchBoard(["t1"])).rejects.toThrow(/failed \(500\)/);
  });
});
