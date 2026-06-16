/**
 * Fallback shown by the root Sentry ErrorBoundary (wired in `main.jsx`) when the
 * app throws during render — a reload prompt instead of a blank white screen.
 */
export default function CrashFallback() {
  return (
    <div
      style={{ maxWidth: 420, margin: "20vh auto", textAlign: "center", fontFamily: "system-ui" }}
    >
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ color: "#555", marginBottom: 16 }}>
        The page hit an unexpected error. Reloading usually fixes it.
      </p>
      <button onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
