/**
 * WiFi BSSID/SSID capture via NetInfo — a second, harder-to-spoof location
 * signal that also works indoors where GPS degrades. On Android, `bssid`/`ssid`
 * are populated only when location permission is granted and location services
 * are on (which clock-in already requests). iOS returns null. Best-effort: a
 * failure just yields nulls and the punch proceeds.
 */

import NetInfo from "@react-native-community/netinfo";

export interface WifiReading {
  wifi_bssid: string | null;
  wifi_ssid: string | null;
}

const EMPTY: WifiReading = { wifi_bssid: null, wifi_ssid: null };

export async function getWifi(): Promise<WifiReading> {
  try {
    const state = await NetInfo.fetch();
    if (state.type === "wifi") {
      return {
        wifi_bssid: state.details.bssid ?? null,
        wifi_ssid: state.details.ssid ?? null,
      };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}
