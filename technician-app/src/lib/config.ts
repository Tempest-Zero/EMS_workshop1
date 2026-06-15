/**
 * App configuration from EXPO_PUBLIC_* env vars (inlined into the JS bundle at
 * build time). Where EXPO_PUBLIC_API_URL comes from depends on the build:
 *
 *   - development : local `.env` (Metro reads it) → your dev machine's LAN IP
 *   - preview     : eas.json `build.preview.env`   → the prod backend (the
 *                   demo/QA APKs point at prod; there is no separate staging
 *                   environment yet)
 *   - production  : eas.json `build.production.env` → the prod backend
 *
 * The fallback below is only used if nothing set it: 10.0.2.2 is the Android
 * emulator's host-loopback IP, handy for a quick emulator run with no .env.
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
