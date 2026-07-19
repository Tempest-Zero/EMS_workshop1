/**
 * Hardened on-device address search for the intake wizard ("Where & How").
 *
 * expo-location's geocoder wraps the platform Geocoder — on Android that is
 * a Google service reached through Play Services: free and unmetered, but it
 * needs a network connection, resolves well-formed ADDRESSES rather than
 * fuzzy/landmark queries, returns coordinates only, and is rate-limited.
 * This module compensates algorithmically instead of calling a paid Places
 * API: normalize (abbreviation expansion, Karachi area aliases, landmark
 * split) → a ≤3-rung progressively-relaxed query ladder → Karachi
 * bounding-box filter with ~100 m de-dup → reverse-geocoded labels, plus an
 * AsyncStorage LRU of recent picks so repeat areas cost zero geocoder calls.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

export interface AddressCandidate {
  label: string;
  lat: number;
  lng: number;
  /** True when only the AREA was resolved — the pin needs a manual nudge. */
  approximate?: boolean;
}

export interface NormalizedQuery {
  /** The whole query, whitespace-collapsed and abbreviation-expanded. */
  full: string;
  /** The part before a "near/opposite/behind…" landmark phrase. */
  primary: string;
  /** The landmark phrase, when one was split off. */
  landmark: string | null;
  /** Canonical Karachi area name recognized in the query, if any. */
  area: string | null;
}

export type SearchStatus = "ok" | "no_match" | "outside" | "offline";

export interface SearchResult {
  status: SearchStatus;
  candidates: AddressCandidate[];
}

// Word-level expansions for how addresses actually get typed at intake.
const TOKEN_EXPANSIONS: [RegExp, string][] = [
  [/\bfb area\b/gi, "Federal B Area"],
  [/\bblk\b/gi, "Block"],
  [/\bst\b/gi, "Street"],
  [/\brd\b/gi, "Road"],
  [/\bsec\b/gi, "Sector"],
  [/\bsoc\b/gi, "Society"],
  [/\bapt\b/gi, "Apartment"],
  [/\bdha\b/gi, "DHA"],
  [/\bnn\b/gi, "North Nazimabad"],
  [/\bpechs\b/gi, "PECHS"],
  [/\bkhi\b/gi, "Karachi"],
];

// Casual spelling → canonical area. Longest keys first so "north nazimabad"
// wins over "nazimabad" and "gulistan-e-johar" over "johar".
const AREA_ALIASES: [string, string][] = [
  ["gulistan-e-johar", "Gulistan-e-Johar"],
  ["gulshan-e-iqbal", "Gulshan-e-Iqbal"],
  ["north nazimabad", "North Nazimabad"],
  ["federal b area", "Federal B Area"],
  ["north karachi", "North Karachi"],
  ["bahadurabad", "Bahadurabad"],
  ["liaquatabad", "Liaquatabad"],
  ["shah faisal", "Shah Faisal Colony"],
  ["nazimabad", "Nazimabad"],
  ["defence", "DHA"],
  ["clifton", "Clifton"],
  ["gulberg", "Gulberg"],
  ["gulshan", "Gulshan-e-Iqbal"],
  ["korangi", "Korangi"],
  ["landhi", "Landhi"],
  ["orangi", "Orangi"],
  ["saddar", "Saddar"],
  ["johar", "Gulistan-e-Johar"],
  ["lyari", "Lyari"],
  ["malir", "Malir"],
  ["pechs", "PECHS"],
  ["site", "SITE"],
  ["dha", "DHA"],
];

const LANDMARK_SPLIT = /\b(?:near|opp|opposite|behind|beside|next to)\b/i;

export function normalizeQuery(raw: string): NormalizedQuery {
  let full = raw.replace(/\s+/g, " ").trim();
  for (const [re, out] of TOKEN_EXPANSIONS) full = full.replace(re, out);

  let primary = full;
  let landmark: string | null = null;
  const m = LANDMARK_SPLIT.exec(full);
  if (m) {
    const before = full.slice(0, m.index).replace(/[\s,]+$/, "");
    const after = full.slice(m.index + m[0].length).trim();
    if (before.length > 0 && after.length > 0) {
      primary = before;
      landmark = after;
    }
  }

  let area: string | null = null;
  for (const [key, canonical] of AREA_ALIASES) {
    if (new RegExp(`\\b${key}\\b`, "i").test(full)) {
      area = canonical;
      break;
    }
  }

  return { full, primary, landmark, area };
}

export interface LadderRung {
  query: string;
  /** Rung 3 resolves only the area — its hits need a manual pin nudge. */
  approximate: boolean;
}

const CITY_RE = /\bkarachi\b|\bpakistan\b/i;
const withCity = (q: string): string => (CITY_RE.test(q) ? q : `${q}, Karachi, Pakistan`);

/**
 * ≤3 progressively-relaxed geocoder queries: ① the full query, ② the query
 * without its landmark phrase (the geocoder chokes on "near X"), ③ the bare
 * recognized area. Bounded because the platform geocoder is rate-limited.
 */
export function buildQueryLadder(n: NormalizedQuery): LadderRung[] {
  const rungs: LadderRung[] = [{ query: withCity(n.full), approximate: false }];
  if (n.landmark !== null && n.primary !== n.full && n.primary.length >= 3) {
    rungs.push({ query: withCity(n.primary), approximate: false });
  }
  if (n.area !== null) {
    rungs.push({ query: `${n.area}, Karachi, Pakistan`, approximate: true });
  }
  const seen = new Set<string>();
  return rungs
    .filter((r) => {
      const key = r.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

export const KARACHI_BBOX = { minLat: 24.75, maxLat: 25.15, minLng: 66.6, maxLng: 67.6 };

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** ~100 m in degrees — near-identical geocoder hits are noise, not choice. */
const DEDUP_DEG = 0.001;
const MAX_CANDIDATES = 3;

/**
 * Keep only in-Karachi hits (an ambiguous area name must not silently land
 * in another city), de-dup near-identical points, cap at 3. `allOutside`
 * lets the caller say "that resolved outside Karachi" instead of "no match".
 */
export function filterCandidates(hits: GeoPoint[]): { kept: GeoPoint[]; allOutside: boolean } {
  const inside = hits.filter(
    (h) =>
      h.latitude >= KARACHI_BBOX.minLat &&
      h.latitude <= KARACHI_BBOX.maxLat &&
      h.longitude >= KARACHI_BBOX.minLng &&
      h.longitude <= KARACHI_BBOX.maxLng,
  );
  const kept: GeoPoint[] = [];
  for (const h of inside) {
    const dup = kept.some(
      (k) =>
        Math.abs(k.latitude - h.latitude) < DEDUP_DEG &&
        Math.abs(k.longitude - h.longitude) < DEDUP_DEG,
    );
    if (!dup) kept.push(h);
    if (kept.length >= MAX_CANDIDATES) break;
  }
  return { kept, allOutside: hits.length > 0 && inside.length === 0 };
}

/** Structural subset of expo-location's LocationGeocodedAddress, so tests
 * (and this formatter) never depend on the native module's types. */
export interface GeocodedAddressParts {
  name?: string | null;
  streetNumber?: string | null;
  street?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
}

export function formatGeocodedAddress(a: GeocodedAddressParts): string {
  const street = a.street ? [a.streetNumber, a.street].filter(Boolean).join(" ") : null;
  const parts = [a.name, street, a.district ?? a.subregion, a.city];
  const out: string[] = [];
  for (const part of parts) {
    const v = part?.trim();
    if (!v) continue;
    if (out.some((o) => o.toLowerCase() === v.toLowerCase())) continue;
    out.push(v);
  }
  return out.join(", ");
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("geocode timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const DEFAULT_TIMEOUT_MS = 6_000;

/**
 * The full pipeline. Never throws. Status semantics:
 * - ok       → 1–3 labeled candidates
 * - no_match → geocoder answered but found nothing usable
 * - outside  → every hit fell outside Karachi (probable wrong-city match)
 * - offline  → every attempted rung failed/timed out (no network / no
 *              Play Services — the platform geocoder is NOT offline-capable)
 */
export async function searchAddress(
  raw: string,
  opts: { timeoutMs?: number } = {},
): Promise<SearchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const normalized = normalizeQuery(raw);
  if (normalized.full.length < 3) return { status: "no_match", candidates: [] };

  // Android's geocoder doesn't strictly need the location permission, but
  // requesting it mirrors attendance/location.ts and avoids vendor quirks;
  // a denial never blocks the search.
  await Location.requestForegroundPermissionsAsync().catch(() => undefined);

  const ladder = buildQueryLadder(normalized);
  let sawOutside = false;
  let failures = 0;

  for (const rung of ladder) {
    let hits: GeoPoint[];
    try {
      hits = await withTimeout(Location.geocodeAsync(rung.query), timeoutMs);
    } catch {
      failures += 1;
      continue;
    }
    const { kept, allOutside } = filterCandidates(hits);
    if (allOutside) sawOutside = true;
    if (kept.length === 0) continue;

    const candidates = await Promise.all(
      kept.map(async (pt): Promise<AddressCandidate> => {
        let label = "";
        try {
          const found = await withTimeout(
            Location.reverseGeocodeAsync({ latitude: pt.latitude, longitude: pt.longitude }),
            timeoutMs,
          );
          const addr = found[0];
          if (addr) label = formatGeocodedAddress(addr);
        } catch {
          /* fall back to the typed text below */
        }
        return {
          label: label || normalized.full,
          lat: pt.latitude,
          lng: pt.longitude,
          approximate: rung.approximate || undefined,
        };
      }),
    );
    return { status: "ok", candidates };
  }

  if (failures === ladder.length) return { status: "offline", candidates: [] };
  if (sawOutside) return { status: "outside", candidates: [] };
  return { status: "no_match", candidates: [] };
}

// ---------------------------------------------------------------------------
// Recent picks — repeat intake areas cost zero geocoder calls.
// ---------------------------------------------------------------------------

const RECENTS_KEY = "fixflow_addr_recent";
const RECENTS_CAP = 15;

export async function loadRecents(): Promise<AddressCandidate[]> {
  try {
    const stored = await AsyncStorage.getItem(RECENTS_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is AddressCandidate =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as AddressCandidate).label === "string" &&
        typeof (c as AddressCandidate).lat === "number" &&
        typeof (c as AddressCandidate).lng === "number",
    );
  } catch {
    return [];
  }
}

/** LRU by label (case-insensitive): newest pick first, capped, best-effort. */
export async function rememberPick(c: AddressCandidate): Promise<void> {
  try {
    const existing = await loadRecents();
    const rest = existing.filter((e) => e.label.toLowerCase() !== c.label.toLowerCase());
    await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify([c, ...rest].slice(0, RECENTS_CAP)));
  } catch {
    /* recents are best-effort */
  }
}
