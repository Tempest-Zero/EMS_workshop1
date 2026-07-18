/**
 * A navigation ref the app can drive from OUTSIDE React — specifically the
 * notification-response handler, which fires when the tech taps an attendance
 * prompt (possibly a cold start, before any screen has focus).
 *
 * Also home to the ROOT stack's param list: the authed app is a native stack
 * rooted at the Dashboard hub (the old bottom tabs became hub cards), with the
 * arrival wizard + bill sheet as root-level modals so any screen can open them.
 */

import { createNavigationContainerRef, type NavigatorScreenParams } from "@react-navigation/native";

import type { JobsStackParamList } from "../features/jobs/types";

export type RootStackParamList = {
  DashboardHub: undefined;
  // Nested JobsStack — params let outside-React callers deep-link a stack screen
  // (e.g. the geofence travel prompt → the Travel screen).
  "My Jobs": NavigatorScreenParams<JobsStackParamList> | undefined;
  Clock: undefined;
  Profile: undefined;
  ArrivalWizard: { id: string; token: number; arrivalTime?: number };
  BillSheet: { id: string; token: number };
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/** Jump to the Clock screen. No-op until the container is mounted. */
export function navigateToClock(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate("Clock");
  }
}

/** Deep-link the Travel screen for a specific job (the geofence travel/return
 * prompts). No-op until the container is mounted. */
export function navigateToJobTravel(
  id: string,
  token: number,
  leg: "outbound" | "return" = "outbound",
): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate("My Jobs", { screen: "Travel", params: { id, token, leg } });
  }
}

/** Open the jobs hub (the travel prompt's fallback when several jobs qualify). */
export function navigateToJobs(): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate("My Jobs", { screen: "JobCategories" });
  }
}
