/**
 * App configuration sourced from EXPO_PUBLIC_* env vars (inlined at bundle time).
 *
 * `apiUrl` defaults to 10.0.2.2:8000 — the Android-emulator special IP that
 * tunnels to the host machine's localhost. For a real phone on the same LAN
 * as the dev machine, set EXPO_PUBLIC_API_URL to that machine's LAN IP in
 * `.env`.
 */
const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:8000";

export const config = {
  apiUrl,
  /**
   * Compression target. 720p at ~2.5 Mbps is more than enough to verify an
   * appliance is running correctly, lands comfortably under Supabase free
   * tier's 50 MB cap for short clips, and stays kind to mobile data. Bump on
   * a paid tier by changing these numbers — no other code needs to move.
   */
  compress: {
    maxSize: 720,
    bitrate: 2_500_000,
  },
} as const;
