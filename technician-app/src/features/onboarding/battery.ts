/**
 * Battery-optimization exemption for the attendance foreground service.
 *
 * The field fleet is Xiaomi/Oppo/Vivo-class Android, which kills foreground
 * services aggressively under battery optimization. When that happens the
 * ping sampler stops mid-shift and coverage collapses to `no_data` — which a
 * manager can misread as the tech hiding, not the phone killing the service.
 * The honest fix is to ask the OS to exempt us, once, during onboarding (and to
 * re-offer it if it gets turned back off while on duty).
 *
 * We use the DIRECT exemption dialog (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS),
 * which needs the matching manifest permission. That's fine here: this is an
 * internal, EAS-distributed APK, not a Play Store listing (Google restricts the
 * permission on the Store). If the direct dialog can't be resolved on a given
 * OEM ROM we fall back to the battery-optimization settings LIST, which needs no
 * permission. Every probe is best-effort — a failure must never block the app.
 */

import * as Battery from "expo-battery";
import * as IntentLauncher from "expo-intent-launcher";

// The app's own package (must match app.json android.package) — the direct
// dialog is scoped to it via a package: URI. Hardcoded rather than read from
// app.json to avoid a JSON import / an expo-application dependency just for this.
const PACKAGE = "com.fixflow.technician";

/**
 * Is battery optimization currently ENABLED for this app? (Enabled = the OS may
 * kill our foreground service; that's the state we want to clear.) Never throws
 * — a probe failure reports `false` so we don't nag on a device that can't
 * answer.
 */
export async function isBatteryOptimizationEnabled(): Promise<boolean> {
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/**
 * Ask the OS to exempt us from battery optimization. No-op if already exempt.
 * Tries the direct system dialog first, falls back to the settings list if the
 * OEM ROM doesn't resolve it, then re-probes and reports whether we ended up
 * exempt. Best-effort throughout.
 */
export async function requestBatteryExemption(): Promise<boolean> {
  if (!(await isBatteryOptimizationEnabled())) return true; // already exempt
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
      { data: `package:${PACKAGE}` },
    );
  } catch {
    // The direct dialog isn't available (some OEM ROMs) — open the settings
    // list instead, which needs no special permission.
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
      );
    } catch {
      return false; // couldn't surface anything — leave it for the recheck banner
    }
  }
  // Re-probe: the user may have granted, declined, or backed out.
  return !(await isBatteryOptimizationEnabled());
}
