/**
 * A navigation ref the app can drive from OUTSIDE React — specifically the
 * notification-response handler, which fires when the tech taps an attendance
 * prompt (possibly a cold start, before any screen has focus).
 */

import { createNavigationContainerRef } from "@react-navigation/native";

export const navigationRef = createNavigationContainerRef();

/** Jump to the Clock tab. No-op until the container is mounted. */
export function navigateToClock(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate("Clock" as never);
  }
}
