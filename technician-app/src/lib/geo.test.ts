import { haversineM } from "./geo";

// Mirrors backend/app/features/attendance/tests/test_derive.py haversine cases,
// so the phone and the server measure the same fence the same way.
describe("haversineM", () => {
  it("is zero for the same point", () => {
    expect(haversineM(24.86, 67.0, 24.86, 67.0)).toBe(0);
  });

  it("is ~111 m for 0.001 deg of latitude", () => {
    const d = haversineM(24.86, 67.0, 24.861, 67.0);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });

  it("is symmetric", () => {
    const a = haversineM(24.86, 67.0, 24.87, 67.01);
    const b = haversineM(24.87, 67.01, 24.86, 67.0);
    expect(a).toBeCloseTo(b, 6);
  });
});
