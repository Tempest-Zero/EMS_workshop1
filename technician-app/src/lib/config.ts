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
   * appliance is running correctly, lands comfortably under the backend's
   * finalize ceiling (`r2_max_upload_bytes`) for short clips, and stays kind to
   * mobile data. Bump these numbers if the ceiling is raised — no other code
   * needs to move.
   */
  compress: {
    maxSize: 720,
    bitrate: 2_500_000,
  },
  /**
   * Evidence-video duration bounds (ms). Android camera apps frequently
   * ignore ImagePicker's `videoMaxDuration`, and nothing enforces a minimum —
   * so clips are checked after capture. Targets are 15s (before/after) and
   * 60s (closing); each max allows some camera overshoot past the target.
   */
  video: {
    minMs: 3_000,
    maxBeforeAfterMs: 20_000,
    maxClosingMs: 75_000,
  },
  attendance: {
    /**
     * Privacy failsafe: the hard ceiling (hours) on a single on-duty tracking
     * session. All three ping-tracker privacy layers key off "did they punch
     * out", never elapsed time — so a tech who FORGETS to clock out would be
     * location-sampled indefinitely (the duty cache even re-arms it on the next
     * launch). This bounds that: past this age the sampler auto-stops and the
     * tech is nudged to clock out. 14h clears any legitimate shift + overtime
     * while still stopping an overnight "left it running" case. We deliberately
     * do NOT auto-punch a clock-out — that would fabricate attendance evidence.
     */
    maxDutyHours: 14,
  },
} as const;
