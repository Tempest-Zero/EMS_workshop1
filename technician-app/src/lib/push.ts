/**
 * Push registration (Module 2 — "notification dispatched to technician").
 *
 * Best-effort: a permission denial or token failure is swallowed, since push is
 * not critical to the app functioning. On login the device's Expo push token is
 * registered to the backend, which sends a notification when a job is assigned.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { registerDevice } from "./devicesApi";

// From app.json → extra.eas.projectId. Required for getExpoPushTokenAsync.
const EAS_PROJECT_ID = "eb1d2f9f-2427-4aaf-934b-0e996b290692";

// Show a banner even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPush(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Job alerts",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID })).data;
    await registerDevice(token);
  } catch {
    // best-effort — push is non-critical
  }
}
