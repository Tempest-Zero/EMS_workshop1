/**
 * Background geofence monitoring — the heart of the "arrive prompt" feature.
 *
 * When the phone crosses the workshop fence (OS-level geofencing, so it fires
 * even with the app closed) we do TWO things:
 *   1. Log a passive presence crossing to the server (queued offline). This is
 *      the anti-fraud record: a missing clock-in is ambiguous, but a logged
 *      `arrive` proves the phone was here — defeating "I forgot but I was here".
 *   2. Fire a local notification nudging the tech to clock in (or out). The
 *      friction-reducer: the app remembers so the tech doesn't have to.
 *
 * The task body runs in a HEADLESS JS context (no React, cold module state), so
 * everything here is plain functions reading identity/token from storage — never
 * hooks or context. `handleGeofenceEvent` is split out and exported so it can be
 * unit-tested without driving the OS.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { attendanceApi, type ActiveGeofence, type PresenceKind } from "../../lib/attendanceApi";
import { getToken, loadToken } from "../../lib/auth";
import { getLocation } from "./location";
import { notifyArrived, notifyLeaving } from "./attendanceNotifications";
import { enqueuePresence, type QueuedPresence } from "./presenceQueue";
import { syncPresence } from "./presenceSync";
import { getWifi } from "./wifi";

export const GEOFENCE_TASK = "fixflow-attendance-geofence";
const FENCE_ID = "workshop";

// Mirrors AuthContext's `TECH_KEY` — the headless task can't reach the auth
// context, so it reads the persisted technician directly.
const TECH_KEY = "fixflow_tech";
const FENCE_CACHE_KEY = "attendance.geofence.cache.v1";
const LAST_CROSSING_KEY = "attendance.presence.lastCrossing.v1";

// Boundary jitter can fire Enter/Exit in quick succession; ignore a repeat of
// the SAME kind within this window so we don't spam the server or the tech.
const DEBOUNCE_MS = 3 * 60 * 1000;

async function getSignedInTechId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TECH_KEY);
    if (!raw) return null;
    const tech = JSON.parse(raw) as { id?: string };
    return tech.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The kind of the most recent geofence crossing, or null if none yet. Lets the
 * ClockScreen show a sticky "you're at the workshop — clock in" reminder that
 * survives a dismissed/missed arrival notification.
 */
export async function getLastCrossingKind(): Promise<PresenceKind | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CROSSING_KEY);
    if (!raw) return null;
    const last = JSON.parse(raw) as { kind?: PresenceKind };
    return last.kind ?? null;
  } catch {
    return null;
  }
}

/** True when an identical crossing landed within the debounce window. */
async function isDuplicate(kind: PresenceKind): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_CROSSING_KEY);
    if (raw) {
      const last = JSON.parse(raw) as { kind: PresenceKind; at: number };
      if (last.kind === kind && Date.now() - last.at < DEBOUNCE_MS) return true;
    }
  } catch {
    // fall through — treat as not a duplicate
  }
  await AsyncStorage.setItem(LAST_CROSSING_KEY, JSON.stringify({ kind, at: Date.now() }));
  return false;
}

/** Capture evidence, queue the crossing, and kick a sync (offline-tolerant). */
export async function recordCrossing(kind: PresenceKind, techId: string): Promise<QueuedPresence> {
  const [loc, wifi] = await Promise.all([getLocation(), getWifi()]);
  const now = new Date().toISOString();
  const item: QueuedPresence = {
    client_id: Crypto.randomUUID(),
    tech_id: techId,
    shop_id: "default",
    kind,
    device_time: now,
    lat: loc.lat,
    lng: loc.lng,
    accuracy_m: loc.accuracy_m,
    is_mock_location: loc.is_mock_location,
    wifi_bssid: wifi.wifi_bssid,
    wifi_ssid: wifi.wifi_ssid,
    done: false,
    created_at: now,
  };
  await enqueuePresence(item); // local write = never lost
  void syncPresence(techId); // best-effort flush; retries on later triggers
  return item;
}

/** Best-effort clock state. `null` = couldn't tell (offline / error). */
async function isClockedIn(techId: string): Promise<boolean | null> {
  try {
    if (!getToken()) await loadToken();
    const today = await attendanceApi.today(techId);
    return today.clocked_in;
  } catch {
    return null;
  }
}

/**
 * Decide-and-act on one geofence crossing. Exported for unit tests — the OS task
 * is a thin wrapper around this.
 */
export async function handleGeofenceEvent(
  eventType: Location.GeofencingEventType,
): Promise<void> {
  const techId = await getSignedInTechId();
  if (!techId) return; // nobody signed in — nothing to attribute or remind

  if (eventType === Location.GeofencingEventType.Enter) {
    if (await isDuplicate("arrive")) return;
    await recordCrossing("arrive", techId);
    // Don't nag if already on duty. If the check can't run (offline), err toward
    // reminding — a redundant prompt is cheaper than a forgotten clock-in.
    if ((await isClockedIn(techId)) !== true) await notifyArrived();
  } else if (eventType === Location.GeofencingEventType.Exit) {
    if (await isDuplicate("depart")) return;
    await recordCrossing("depart", techId);
    // Only remind to clock OUT when we positively know they're clocked in;
    // nagging someone who never clocked in is worse than staying quiet.
    if ((await isClockedIn(techId)) === true) await notifyLeaving();
  }
}

// Register the headless task at module load (imported from `index.ts` so it's
// defined before any background invocation, including app-closed launches).
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const { eventType } = (data ?? {}) as { eventType: Location.GeofencingEventType };
  await handleGeofenceEvent(eventType);
});

async function fetchActiveFence(): Promise<ActiveGeofence | null> {
  try {
    if (!getToken()) await loadToken();
    const fence = await attendanceApi.activeGeofence();
    await AsyncStorage.setItem(FENCE_CACHE_KEY, JSON.stringify(fence)); // cache (incl. null)
    return fence;
  } catch {
    // Offline: fall back to the last known fence so monitoring survives a
    // launch with no connectivity.
    try {
      const raw = await AsyncStorage.getItem(FENCE_CACHE_KEY);
      return raw ? (JSON.parse(raw) as ActiveGeofence | null) : null;
    } catch {
      return null;
    }
  }
}

async function stopGeofencing(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // ignore
  }
}

/**
 * (Re)register OS geofencing for the active fence. Idempotent — safe to call on
 * every app foreground, which is also how we recover after a reboot (Android
 * drops registered geofences on restart). No-ops without background-location
 * permission (onboarding requests it) or an active fence.
 */
export async function ensureGeofenceMonitoring(): Promise<void> {
  try {
    const [fg, bg] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    if (!fg.granted || !bg.granted) {
      await stopGeofencing();
      return;
    }
    const fence = await fetchActiveFence();
    if (!fence || !fence.is_active) {
      await stopGeofencing();
      return;
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      {
        identifier: FENCE_ID,
        latitude: fence.center_lat,
        longitude: fence.center_lng,
        radius: fence.radius_m,
        notifyOnEnter: true,
        notifyOnExit: true,
      },
    ]);
  } catch {
    // best-effort — a registration failure must never crash the app
  }
}
