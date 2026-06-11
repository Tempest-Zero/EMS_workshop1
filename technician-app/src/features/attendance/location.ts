/**
 * GPS capture. Returns the device's coordinates, accuracy, and — crucially on
 * Android — whether the fix came from a mock-location app (`pos.mocked`). We
 * never block on location: if permission is denied or the fix fails, the punch
 * still records with null coordinates (the backend treats that as "unknown").
 */

import * as Location from "expo-location";

export interface LocationReading {
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  is_mock_location: boolean;
}

const EMPTY: LocationReading = {
  lat: null,
  lng: null,
  accuracy_m: null,
  is_mock_location: false,
};

export async function getLocation(): Promise<LocationReading> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return EMPTY;
    // High accuracy: the workshop fence is ~80 m, and the backend treats a
    // fix coarser than its accuracy ceiling as "unknown" — a Balanced fix
    // (often 20–65 m, worse indoors) wastes the punch's evidence value.
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy ?? null,
      // Android-only: true when a fake-GPS app supplied the fix. Undefined on iOS.
      is_mock_location: pos.mocked ?? false,
    };
  } catch {
    return EMPTY;
  }
}
