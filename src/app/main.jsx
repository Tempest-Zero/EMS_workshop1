import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import App from "@app/App";
import { AppProvider } from "@app/providers/AppContext";
import { AuthProvider } from "@app/providers/AuthContext";
import CrashFallback from "@app/components/CrashFallback";
import { ErrorBoundary, initSentry } from "@shared/lib/sentry";

// Before anything renders, so a crash during initial mount is still captured.
initSentry();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashFallback />}>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>
);
