/**
 * Permission priming for the attendance reminders. The background-location
 * ("Allow all the time") grant is the single hardest yes in the app and the one
 * the whole geofence feature depends on — so we ask for it from a screen that
 * has just explained WHY, in order (notifications → foreground → background),
 * which is also the order Android requires (it won't offer "all the time" until
 * "while using" is granted).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

import { requestBatteryExemption } from "./battery";

const ONBOARDED_KEY = "attendance.onboarded.v1";

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function markOnboarded(): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // non-fatal — worst case the explainer shows again next launch
  }
}

export interface PermissionResult {
  notifications: boolean;
  foreground: boolean;
  background: boolean;
  batteryExempt: boolean;
}

export async function requestAttendancePermissions(): Promise<PermissionResult> {
  // Notifications (Android 13+ needs a runtime grant to show the prompts).
  let notifications = (await Notifications.getPermissionsAsync()).granted;
  if (!notifications) {
    notifications = (await Notifications.requestPermissionsAsync()).granted;
  }

  // Foreground location MUST come first — Android only offers "all the time"
  // once "while using the app" is granted.
  let foreground = (await Location.getForegroundPermissionsAsync()).granted;
  if (!foreground) {
    foreground = (await Location.requestForegroundPermissionsAsync()).granted;
  }

  // Background ("Allow all the time") — the grant that lets the fence fire while
  // the app is closed. Only meaningful once foreground is granted.
  let background = false;
  if (foreground) {
    background = (await Location.getBackgroundPermissionsAsync()).granted;
    if (!background) {
      background = (await Location.requestBackgroundPermissionsAsync()).granted;
    }
  }

  // Battery-optimization exemption LAST — after the hardest-yes (background
  // location), so we don't spend the user's goodwill before the grant the whole
  // feature depends on. Without it, OEM battery savers kill the foreground
  // service mid-shift and coverage collapses to no_data. Best-effort.
  const batteryExempt = await requestBatteryExemption();

  return { notifications, foreground, background, batteryExempt };
}
