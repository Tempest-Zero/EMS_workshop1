/**
 * The address-search pipeline is pure logic around two mocked expo-location
 * calls — same convention as the attendance sync tests: mock the native
 * modules, drive the module's public API, assert behavior.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import {
  buildQueryLadder,
  filterCandidates,
  formatGeocodedAddress,
  loadRecents,
  normalizeQuery,
  rememberPick,
  searchAddress,
} from "./addressSearch";

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store[k] ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store[k] = v;
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const geocode = Location.geocodeAsync as jest.Mock;
const reverse = Location.reverseGeocodeAsync as jest.Mock;
const permission = Location.requestForegroundPermissionsAsync as jest.Mock;

const IN_PT = { latitude: 24.86, longitude: 67.03 };
const IN_PT_2 = { latitude: 24.95, longitude: 67.1 };
const OUT_PT = { latitude: 31.5204, longitude: 74.3587 }; // Lahore

const ADDR = {
  name: "Sea View Apartments",
  streetNumber: null,
  street: null,
  district: "Clifton",
  subregion: null,
  city: "Karachi",
  region: "Sindh",
  country: "Pakistan",
  postalCode: null,
  isoCountryCode: "PK",
};

beforeEach(async () => {
  geocode.mockReset();
  reverse.mockReset();
  permission.mockReset();
  permission.mockResolvedValue({ granted: true });
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
});

describe("normalizeQuery", () => {
  it("collapses whitespace and expands intake abbreviations", () => {
    expect(normalizeQuery("  blk 5   rd 3 ").full).toBe("Block 5 Road 3");
  });

  it("recognizes a casual area spelling as its canonical area", () => {
    expect(normalizeQuery("house 12 gulshan").area).toBe("Gulshan-e-Iqbal");
  });

  it("matches longer area names before their substrings", () => {
    expect(normalizeQuery("north nazimabad block B").area).toBe("North Nazimabad");
  });

  it("splits a landmark phrase off the primary address", () => {
    const n = normalizeQuery("House 5 Clifton near Teen Talwar");
    expect(n.primary).toBe("House 5 Clifton");
    expect(n.landmark).toBe("Teen Talwar");
    expect(n.area).toBe("Clifton");
  });

  it("keeps the full query as primary when there is no landmark", () => {
    const n = normalizeQuery("Bahadurabad Block 3");
    expect(n.primary).toBe(n.full);
    expect(n.landmark).toBeNull();
  });
});

describe("buildQueryLadder", () => {
  it("builds full → primary → area, area rung marked approximate", () => {
    const ladder = buildQueryLadder(normalizeQuery("House 5 Clifton near Teen Talwar"));
    expect(ladder).toEqual([
      { query: "House 5 Clifton near Teen Talwar, Karachi, Pakistan", approximate: false },
      { query: "House 5 Clifton, Karachi, Pakistan", approximate: false },
      { query: "Clifton, Karachi, Pakistan", approximate: true },
    ]);
  });

  it("does not double-append the city when the query already names it", () => {
    const ladder = buildQueryLadder(normalizeQuery("Clifton Karachi"));
    expect(ladder[0]?.query).toBe("Clifton Karachi");
  });

  it("de-duplicates identical rungs", () => {
    // "Clifton" alone: rung 1 and the area rung render the same string.
    const ladder = buildQueryLadder(normalizeQuery("Clifton"));
    expect(ladder).toHaveLength(1);
    expect(ladder[0]?.query).toBe("Clifton, Karachi, Pakistan");
  });

  it("never exceeds three rungs", () => {
    const ladder = buildQueryLadder(normalizeQuery("plot 1 gulshan near disco bakery opposite park"));
    expect(ladder.length).toBeLessThanOrEqual(3);
  });
});

describe("filterCandidates", () => {
  it("keeps in-Karachi hits and drops outside ones", () => {
    const { kept, allOutside } = filterCandidates([IN_PT, OUT_PT]);
    expect(kept).toEqual([IN_PT]);
    expect(allOutside).toBe(false);
  });

  it("reports when every hit fell outside Karachi", () => {
    const { kept, allOutside } = filterCandidates([OUT_PT]);
    expect(kept).toEqual([]);
    expect(allOutside).toBe(true);
  });

  it("is not 'allOutside' for an empty hit list", () => {
    expect(filterCandidates([]).allOutside).toBe(false);
  });

  it("de-duplicates points within ~100 m", () => {
    const near = { latitude: IN_PT.latitude + 0.0005, longitude: IN_PT.longitude };
    expect(filterCandidates([IN_PT, near]).kept).toHaveLength(1);
  });

  it("caps at three candidates", () => {
    const spread = [0, 1, 2, 3, 4].map((i) => ({
      latitude: 24.8 + i * 0.05,
      longitude: 67.0 + i * 0.05,
    }));
    expect(filterCandidates(spread).kept).toHaveLength(3);
  });
});

describe("formatGeocodedAddress", () => {
  it("joins non-null parts in a stable order", () => {
    expect(
      formatGeocodedAddress({
        name: "Tower",
        streetNumber: "12",
        street: "Sunset Blvd",
        district: "DHA",
        city: "Karachi",
      }),
    ).toBe("Tower, 12 Sunset Blvd, DHA, Karachi");
  });

  it("falls back from district to subregion", () => {
    expect(formatGeocodedAddress({ subregion: "Karachi East", city: "Karachi" })).toBe(
      "Karachi East, Karachi",
    );
  });

  it("de-duplicates repeated parts case-insensitively", () => {
    expect(formatGeocodedAddress({ name: "Clifton", city: "clifton" })).toBe("Clifton");
  });

  it("returns empty for an all-null address", () => {
    expect(formatGeocodedAddress({})).toBe("");
  });
});

describe("searchAddress", () => {
  it("rejects a too-short query without calling the geocoder", async () => {
    const res = await searchAddress("ab");
    expect(res.status).toBe("no_match");
    expect(geocode).not.toHaveBeenCalled();
  });

  it("resolves on the first rung and labels via reverse geocode", async () => {
    geocode.mockResolvedValueOnce([IN_PT]);
    reverse.mockResolvedValueOnce([ADDR]);
    const res = await searchAddress("Sea View apt Clifton");
    expect(res.status).toBe("ok");
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({
      label: "Sea View Apartments, Clifton, Karachi",
      lat: IN_PT.latitude,
      lng: IN_PT.longitude,
    });
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode).toHaveBeenCalledWith("Sea View Apartment Clifton, Karachi, Pakistan");
  });

  it("falls back to the landmark-stripped rung when the full query misses", async () => {
    geocode.mockResolvedValueOnce([]).mockResolvedValueOnce([IN_PT]);
    reverse.mockResolvedValueOnce([ADDR]);
    const res = await searchAddress("House 5 Clifton near Teen Talwar");
    expect(res.status).toBe("ok");
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(geocode).toHaveBeenNthCalledWith(2, "House 5 Clifton, Karachi, Pakistan");
  });

  it("marks area-rung hits as approximate", async () => {
    // Rung 1 (full) misses; no landmark → next rung is the bare area.
    geocode.mockResolvedValueOnce([]).mockResolvedValueOnce([IN_PT]);
    reverse.mockResolvedValueOnce([ADDR]);
    const res = await searchAddress("mystery plaza gulshan");
    expect(res.status).toBe("ok");
    expect(geocode).toHaveBeenNthCalledWith(2, "Gulshan-e-Iqbal, Karachi, Pakistan");
    expect(res.candidates[0]?.approximate).toBe(true);
  });

  it("returns no_match when every rung answers empty", async () => {
    geocode.mockResolvedValue([]);
    const res = await searchAddress("complete gibberish query");
    expect(res.status).toBe("no_match");
    expect(geocode.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("returns outside when hits resolve beyond Karachi", async () => {
    geocode.mockResolvedValue([OUT_PT]);
    const res = await searchAddress("Liberty Market Gulberg");
    expect(res.status).toBe("outside");
    expect(res.candidates).toEqual([]);
  });

  it("returns offline when every rung throws", async () => {
    geocode.mockRejectedValue(new Error("Service not Available"));
    const res = await searchAddress("Clifton Block 2");
    expect(res.status).toBe("offline");
  });

  it("returns offline when the geocoder hangs past the timeout", async () => {
    geocode.mockImplementation(() => new Promise(() => undefined));
    const res = await searchAddress("Clifton Block 2", { timeoutMs: 30 });
    expect(res.status).toBe("offline");
  });

  it("falls back to the typed text when reverse geocoding fails", async () => {
    geocode.mockResolvedValueOnce([IN_PT]);
    reverse.mockRejectedValueOnce(new Error("boom"));
    const res = await searchAddress("Bahadurabad Block 3");
    expect(res.status).toBe("ok");
    expect(res.candidates[0]?.label).toBe("Bahadurabad Block 3");
  });

  it("proceeds even when the location permission is denied", async () => {
    permission.mockResolvedValueOnce({ granted: false });
    geocode.mockResolvedValueOnce([IN_PT]);
    reverse.mockResolvedValueOnce([ADDR]);
    const res = await searchAddress("Clifton Block 2");
    expect(res.status).toBe("ok");
    expect(geocode).toHaveBeenCalled();
  });
});

describe("recents", () => {
  const cand = (label: string) => ({ label, lat: 24.86, lng: 67.03 });

  it("stores picks newest-first", async () => {
    await rememberPick(cand("A"));
    await rememberPick(cand("B"));
    expect((await loadRecents()).map((c) => c.label)).toEqual(["B", "A"]);
  });

  it("moves a re-picked label to the front instead of duplicating", async () => {
    await rememberPick(cand("A"));
    await rememberPick(cand("B"));
    await rememberPick(cand("a"));
    expect((await loadRecents()).map((c) => c.label)).toEqual(["a", "B"]);
  });

  it("caps the list at 15", async () => {
    for (let i = 0; i < 17; i++) await rememberPick(cand(`addr-${i}`));
    const recents = await loadRecents();
    expect(recents).toHaveLength(15);
    expect(recents[0]?.label).toBe("addr-16");
  });

  it("survives corrupted storage", async () => {
    await AsyncStorage.setItem("fixflow_addr_recent", "{not json[");
    expect(await loadRecents()).toEqual([]);
  });
});
