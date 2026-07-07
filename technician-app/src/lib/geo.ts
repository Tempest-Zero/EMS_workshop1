/**
 * Pure geometry — the mobile mirror of `backend/app/shared/geo.py`.
 *
 * Lives in `lib/` (not the attendance feature) because more than one feature
 * needs great-circle distance: attendance confirms geofence crossings client-
 * side, and jobs will want route distance for its fuel estimate — the same
 * reason the backend keeps it in a shared kernel. Dependency-free and pure.
 */

export const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
