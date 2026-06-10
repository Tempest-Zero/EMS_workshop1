/**
 * Error tracking, DSN-gated exactly like the backend: no
 * `EXPO_PUBLIC_SENTRY_DSN` at build time → Sentry never initialises and the
 * app behaves as before. PII stays out of events — the technician roster and
 * customer details are nobody's telemetry.
 *
 * Imported ONLY from App.tsx so tests (which render screens, not the app
 * shell) never load the native module.
 */

import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

export function initSentry(): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: "production",
    sendDefaultPii: false,
    // Crash/error capture only — keep the payload (and the battery) small.
    tracesSampleRate: 0,
  });
}
