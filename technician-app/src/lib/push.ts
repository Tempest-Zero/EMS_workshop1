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
    // The native FCM registration token — the backend sends to it via FCM HTTP v1
    // directly (no Expo relay), so no EAS push credential is needed.
    const { data } = await Notifications.getDevicePushTokenAsync();
    await registerDevice(String(data));
  } catch {
    // best-effort — push is non-critical
  }
}
