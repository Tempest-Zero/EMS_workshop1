/**
 * Local notifications for the geofence attendance prompts. Distinct from the
 * FCM job-alert push (`lib/push.ts`): these are scheduled on-device the moment
 * the phone crosses the workshop fence — including from the headless background
 * task with no UI open — and carry an `action` the tap handler routes on.
 *
 * The friction-reducer half of the feature: the silent presence log is what
 * defeats the "I forgot but I was here" lie; this is what spares the honest,
 * forgetful tech from needing to remember at all.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const ATTENDANCE_CHANNEL = "attendance";

/** Marker on a notification's data so the tap handler knows to open the clock. */
export type AttendanceAction = "clock_in" | "clock_out";

export interface AttendancePromptData {
  type: "attendance_prompt";
  action: AttendanceAction;
}

export async function ensureAttendanceChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ATTENDANCE_CHANNEL, {
    name: "Attendance reminders",
    importance: Notifications.AndroidImportance.HIGH, // heads-up: it's an action prompt
    vibrationPattern: [0, 250, 250, 250],
  });
}

async function prompt(title: string, body: string, action: AttendanceAction): Promise<void> {
  await ensureAttendanceChannel();
  const data: AttendancePromptData = { type: "attendance_prompt", action };
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    // Android needs the channel named on the trigger to surface as heads-up; a
    // 1s interval is the immediate trigger that still carries channelId. iOS
    // (not a target today) takes a null/immediate trigger.
    trigger:
      Platform.OS === "android" ? { channelId: ATTENDANCE_CHANNEL, seconds: 1 } : null,
  });
}

/** Fired on geofence ENTER when the tech isn't already clocked in. */
export async function notifyArrived(): Promise<void> {
  await prompt(
    "You've reached the workshop",
    "Tap to clock in — it only takes a second.",
    "clock_in",
  );
}

/** Fired on geofence EXIT when the tech is still clocked in. */
export async function notifyLeaving(): Promise<void> {
  await prompt(
    "Leaving the workshop?",
    "Don't forget to clock out. Tap to do it now.",
    "clock_out",
  );
}
