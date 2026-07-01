import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import OpsLayout from "@ops/layouts/OpsLayout";
import OpsLogin from "@ops/pages/OpsLogin";
import { useOpsAuth } from "@ops/providers/OpsAuthContext";

// The ops UI lives in the @features/ops slice (runtime-agnostic, kernel-only).
// This composition root wires it to its own auth + layout + router. HashRouter
// (not BrowserRouter) keeps every route under one served file, so the standalone
// build needs no SPA history fallback — it just works behind `serve`.
import {
  Overview,
  Health,
  ApiMetrics,
  RailwayDeployments,
  RailwayLogs,
  RailwayMetrics,
  SentryIssues,
} from "@features/ops";

export default function OpsApp() {
  const { isAuthenticated, ready } = useOpsAuth();

  // Wait for the initial token check so we don't flash the login screen.
  if (!ready) return <div className="min-h-[100svh] bg-[#0b1220]" />;
  if (!isAuthenticated) return <OpsLogin />;

  return (
    <HashRouter>
      <Routes>
        <Route element={<OpsLayout />}>
          <Route index element={<Overview />} />
          <Route path="health" element={<Health />} />
          <Route path="metrics" element={<ApiMetrics />} />
          <Route path="deployments" element={<RailwayDeployments />} />
          <Route path="logs" element={<RailwayLogs />} />
          <Route path="resources" element={<RailwayMetrics />} />
          <Route path="errors" element={<SentryIssues />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
