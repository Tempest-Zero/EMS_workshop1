import { useState } from "react";
import { getRailwayServices } from "@features/ops/data/opsApi";
import { usePolling } from "@features/ops/hooks/usePolling";

// The FixFlow backend — the service a teammate almost always wants first (it has
// the real traffic + logs), not the idle ops/web services. Falls back to the
// first reported service if it isn't present.
const PREFERRED_SERVICE = "efficient-tenderness";

/**
 * Loads the Railway service list (also the canonical "is Railway configured?"
 * signal) and tracks the selected service name, defaulting to the backend once
 * the list arrives. Shared by the Logs / Resources / Deployments tabs.
 *
 * The default is DERIVED during render (the user's explicit choice, else the
 * backend, else the first service) rather than synced via an effect — no
 * setState-in-effect.
 */
export function useServiceSelection() {
  const { data: servicesResp } = usePolling(getRailwayServices, 60000);
  const services = servicesResp?.services ?? [];
  const [chosen, setChosen] = useState("");

  const preferred = services.find((s) => s.name === PREFERRED_SERVICE)?.name;
  const selected = chosen || preferred || services[0]?.name || "";
  return { servicesResp, services, selected, setSelected: setChosen };
}
