import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import OpsApp from "@ops/OpsApp";
import { OpsAuthProvider } from "@ops/providers/OpsAuthContext";
import OpsCrashFallback from "@ops/components/OpsCrashFallback";
import { ErrorBoundary, initSentry } from "@shared/lib/sentry";

// Before anything renders, so a crash during initial mount is still captured.
initSentry();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary fallback={<OpsCrashFallback />}>
      <OpsAuthProvider>
        <OpsApp />
      </OpsAuthProvider>
    </ErrorBoundary>
  </StrictMode>
);
