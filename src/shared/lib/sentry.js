/**
 * Web error tracking, DSN-gated exactly like the backend (`app/main.py`) and the
 * mobile app (`technician-app/src/lib/sentry.ts`): with no `VITE_SENTRY_DSN` at
 * build time, Sentry never initialises and the console behaves exactly as before.
 *
 * PII stays out of events. The manager console handles customer names, phones,
 * and addresses — none of that is telemetry. Errors only: no performance tracing,
 * and Session Replay is deliberately NOT enabled (it would record the screen,
 * customer data and all).
 *
 * Vite inlines `VITE_*` at build time, so the DSN is baked into the bundle — but a
 * Sentry DSN is a write-only ingest key (it ships in every web app's JS), not a
 * secret. Set it as the `web` Railway service's `VITE_SENTRY_DSN` variable;
 * `Dockerfile.web` forwards it into the build.
 */

import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN ?? "";

/** Initialise Sentry once, before the app renders. A no-op without a DSN. */
export function initSentry() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    sendDefaultPii: false,
    // Crash/error capture only — no performance traces, no session replay.
    tracesSampleRate: 0,
  });
}

/**
 * Root error boundary: reports the crash (when a DSN is set) and shows a fallback
 * instead of a blank white screen. Acts as a plain React boundary even with no DSN.
 */
export const ErrorBoundary = Sentry.ErrorBoundary;
