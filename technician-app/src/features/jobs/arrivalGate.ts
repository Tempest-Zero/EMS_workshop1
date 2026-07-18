/**
 * The tap-time arrival gate — the client half of the 0037 verdict contract.
 *
 * Soft-block, by owner decision: "I HAVE ARRIVED" is refused ONLY when the
 * phone confidently knows the tech is far from the target — a good fix
 * (accuracy ≤ GATE_ACCURACY_MAX_M) more than the radius from the pin. An
 * uncertain fix (coarse accuracy) or a missing target always ALLOWS: Karachi
 * GPS is patchy indoors and a hand-dropped intake pin can be wrong — a
 * legitimate tech must never be stranded at the customer's door. The server
 * independently records a distance/verified verdict on every punch (flag-
 * never-block), so anything this gate lets through is still visible to the
 * manager.
 *
 * This gate runs at TAP time on-device (GPS works offline). A punch queued
 * offline replays UNGATED by design — it was gated when tapped, and the
 * server's ingest-time verdict is the backstop.
 *
 * Pure and dependency-light (haversine only) — unit-tested in plain Jest.
 */

import { haversineM } from "../../lib/geo";

/** Matches the server's `jobs_arrival_radius_m` — keep the pair in sync. */
export const ARRIVE_RADIUS_M = 250;
/** Matches the server's `jobs_punch_accuracy_ceiling_m` (and the attendance
 * crossing-confirm ceiling): a coarser fix can't support a block. */
export const GATE_ACCURACY_MAX_M = 100;

export interface GateFix {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
}

export interface GateTarget {
  lat: number;
  lng: number;
}

export type ArrivalVerdict =
  /** Proceed with the punch. `distanceM` is null when there was no target
   * (or no way to judge) — the server still records its own verdict. */
  | { verdict: "allow"; distanceM: number | null }
  /** Confidently far — refuse the punch and show the distance. */
  | { verdict: "block"; distanceM: number }
  /** No usable coordinates at all — the caller keeps its "enable GPS" path. */
  | { verdict: "no_fix"; distanceM: null };

export function evaluateArrival(
  fix: GateFix,
  target: GateTarget | null,
  radiusM: number = ARRIVE_RADIUS_M,
): ArrivalVerdict {
  if (fix.lat == null || fix.lng == null) return { verdict: "no_fix", distanceM: null };
  if (target === null) return { verdict: "allow", distanceM: null };
  const distanceM = haversineM(fix.lat, fix.lng, target.lat, target.lng);
  const confident = fix.accuracy_m != null && fix.accuracy_m <= GATE_ACCURACY_MAX_M;
  if (confident && distanceM > radiusM) return { verdict: "block", distanceM };
  return { verdict: "allow", distanceM };
}

/** "430 m" / "1.4 km" — for the block message. */
export function formatDistanceM(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)} km` : `${Math.round(distanceM)} m`;
}
