/**
 * Wires the background attendance machinery into the authenticated shell:
 *   - (re)registers geofence monitoring on mount and every app-foreground
 *     (the latter also recovers the fence after an Android reboot clears it),
 *   - routes a tapped attendance prompt to the Clock screen, including the
 *     cold-start case where the tap launched the app.
 *
 * Mount once from the authenticated `Tabs` shell so it follows the session.
 */

import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { AppState } from "react-native";

import { navigateToClock, navigateToJobs, navigateToJobTravel } from "../../lib/navigation";
import type { TravelPromptData } from "../jobs/travelPrompt";
import { ensureTravelTracking } from "../jobs/travelTracker";
import type { AttendancePromptData } from "./attendanceNotifications";
import { setAttendancePrompt } from "./attendancePrompt";
import { ensureGeofenceMonitoring } from "./geofence";
import { ensurePingTracking } from "./pingTracker";

function routeFromResponse(response: Notifications.NotificationResponse | null): void {
  const data = response?.notification.request.content.data as
    | Partial<AttendancePromptData>
    | Partial<TravelPromptData>
    | undefined;
  if (data?.type === "attendance_prompt") {
    navigateToClock();
    if (data.action) setAttendancePrompt(data.action);
    return;
  }
  if (data?.type === "travel_prompt") {
    // Single-job nudge deep-links its Travel screen; the multi-job fallback
    // opens the jobs hub so the tech picks.
    if (data.id && typeof data.token === "number") navigateToJobTravel(data.id, data.token);
    else navigateToJobs();
  }
}

export function useAttendanceBackground(): void {
  useEffect(() => {
    void ensureGeofenceMonitoring();
    // Re-arm the on-duty ping tracker too (recovers after a reboot / app-kill
    // if the tech was clocked in — same pattern as the geofence).
    void ensurePingTracking();
    // …and the job-travel breadcrumb sampler: an app killed mid-drive must
    // resume recording on next launch, or the fuel line silently degrades to
    // the estimate (and stops billing the road actually driven).
    void ensureTravelTracking();
    // Cold start: the app was launched by tapping a prompt.
    void Notifications.getLastNotificationResponseAsync().then(routeFromResponse);
    const tap = Notifications.addNotificationResponseReceivedListener(routeFromResponse);
    const app = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        void ensureGeofenceMonitoring();
        void ensurePingTracking();
        void ensureTravelTracking();
      }
    });
    return () => {
      tap.remove();
      app.remove();
    };
  }, []);
}
