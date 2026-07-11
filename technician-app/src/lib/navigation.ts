/**
 * A navigation ref the app can drive from OUTSIDE React — specifically the
 * notification-response handler, which fires when the tech taps an attendance
 * prompt (possibly a cold start, before any screen has focus).
 *
 * Also home to the ROOT stack's param list: the authed app is a native stack
 * rooted at the Dashboard hub (the old bottom tabs became hub cards), with the
 * arrival wizard + bill sheet as root-level modals so any screen can open them.
 */

import { createNavigationContainerRef } from "@react-navigation/native";

export type RootStackParamList = {
  DashboardHub: undefined;
  "My Jobs": undefined; // nested JobsStack — see features/jobs/types.ts
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
