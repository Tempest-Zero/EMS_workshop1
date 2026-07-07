/**
 * Watches whether battery optimization has crept back on for a tech who is
 * currently on duty. If so the OEM battery saver can kill our foreground
 * service and the ping sampler stops — coverage then collapses to `no_data`,
 * which a manager can misread as absence. The clock screen surfaces a
 * non-blocking banner that re-opens the exemption dialog on tap.
 *
 * Probes on mount and whenever the app returns to the foreground (the moment a
 * user is most likely to have just toured Settings). Best-effort: any probe
 * failure reports "no warning" rather than nagging.
 */

import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { isBatteryOptimizationEnabled, requestBatteryExemption } from "../onboarding/battery";

export function useBatteryExemptionWarning(clockedIn: boolean): {
  show: boolean;
  fix: () => Promise<void>;
} {
  const [optimizationOn, setOptimizationOn] = useState(false);

  const probe = useCallback(async () => {
    setOptimizationOn(await isBatteryOptimizationEnabled());
  }, []);

  useEffect(() => {
    void probe();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void probe();
    });
    return () => sub.remove();
  }, [probe]);

  const fix = useCallback(async () => {
    await requestBatteryExemption();
    await probe(); // reflect the new state immediately
  }, [probe]);

  // Only nag while on duty — off the clock there's nothing to keep alive.
  return { show: clockedIn && optimizationOn, fix };
}
