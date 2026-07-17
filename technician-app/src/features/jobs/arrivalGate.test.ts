/**
 * The tap-time arrival gate: block ONLY on a confident, distant fix — an
 * uncertain fix or a missing pin always allows (the server's ingest verdict
 * is the manager's backstop). Every branch here is the owner's soft-block
 * decision made executable.
 */

import { haversineM } from "../../lib/geo";
import {
  ARRIVE_RADIUS_M,
  evaluateArrival,
  formatDistanceM,
  GATE_ACCURACY_MAX_M,
} from "./arrivalGate";

const PIN = { lat: 24.86, lng: 67.0 };
// ~0.001° lat ≈ 111 m; ~0.02° ≈ 2.2 km.
const NEAR = { lat: 24.861, lng: 67.0, accuracy_m: 20 };
const FAR = { lat: 24.88, lng: 67.0, accuracy_m: 20 };

it("allows a confident fix inside the radius", () => {
  const v = evaluateArrival(NEAR, PIN);
  expect(v.verdict).toBe("allow");
  expect(v.distanceM).toBeCloseTo(haversineM(NEAR.lat, NEAR.lng, PIN.lat, PIN.lng), 3);
});

it("blocks a confident fix beyond the radius — with the distance", () => {
  const v = evaluateArrival(FAR, PIN);
  expect(v.verdict).toBe("block");
  expect(v.distanceM).toBeGreaterThan(ARRIVE_RADIUS_M);
});

it("a fix exactly at the radius edge is allowed (block needs CONFIDENTLY far)", () => {
  // ~250 m north of the pin — right on the boundary. <= radius allows.
  const edge = { lat: 24.86 + 250 / 111_320, lng: 67.0, accuracy_m: 10 };
  expect(evaluateArrival(edge, PIN).verdict).toBe("allow");
});

it("allows a coarse fix even when far — GPS that vague can't support a block", () => {
  const v = evaluateArrival({ ...FAR, accuracy_m: GATE_ACCURACY_MAX_M + 50 }, PIN);
  expect(v.verdict).toBe("allow");
  expect(v.distanceM).toBeGreaterThan(ARRIVE_RADIUS_M); // distance still reported
});

it("allows when accuracy is unknown — same reasoning as coarse", () => {
  expect(evaluateArrival({ ...FAR, accuracy_m: null }, PIN).verdict).toBe("allow");
});

it("allows when there is no pin to judge against", () => {
  const v = evaluateArrival(FAR, null);
  expect(v.verdict).toBe("allow");
  expect(v.distanceM).toBeNull();
});

it("no coordinates at all → no_fix (the caller keeps its enable-GPS path)", () => {
  expect(evaluateArrival({ lat: null, lng: null, accuracy_m: 5 }, PIN).verdict).toBe("no_fix");
});

it("honours a custom radius", () => {
  // ~111 m out: blocked under a 50 m radius, allowed under the default 250 m.
  expect(evaluateArrival(NEAR, PIN, 50).verdict).toBe("block");
  expect(evaluateArrival(NEAR, PIN).verdict).toBe("allow");
});

it("formats block distances honestly", () => {
  expect(formatDistanceM(430.4)).toBe("430 m");
  expect(formatDistanceM(1437)).toBe("1.4 km");
});
