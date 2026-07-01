// Public barrel for the ops UI slice — only the routable pages are exported, per
// the repo convention. The standalone ops app (src/ops) wires these into its
// router; every page talks to the backend via @shared/lib/api.
export { default as Overview } from "./pages/Overview";
export { default as Health } from "./pages/Health";
export { default as ApiMetrics } from "./pages/ApiMetrics";
export { default as RailwayDeployments } from "./pages/RailwayDeployments";
export { default as RailwayLogs } from "./pages/RailwayLogs";
export { default as RailwayMetrics } from "./pages/RailwayMetrics";
export { default as SentryIssues } from "./pages/SentryIssues";
