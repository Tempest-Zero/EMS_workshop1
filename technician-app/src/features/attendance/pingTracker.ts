/**
 * On-duty ping tracking. While a tech is clocked in, the OS samples the phone's
 * location on an interval and delivers it to a headless TaskManager task, which
 * queues a ping (offline-tolerant, like a crossing). This is what lets a manager
 * later see a tech left mid-shift — data with context, never an auto-accusation.
 *
 * PRIVACY IS THE FIRST CONSTRAINT. Location is sampled ONLY while clocked in,
 * enforced by three layers:
 *   1. clock-out awaits `stopDutyPings()` before it even syncs (punch.ts),
 *   2. the task body self-stops + discards the fix if it fires while off-duty,
 *   3. logout stops it.
 * A persistent foreground-service notification makes the recording visible, and
 * there is no "locate now" capability — only the interval sampler exists.
 *
 * Like the geofence task this runs in a HEADLESS JS context (no React, cold
 * module state), so everything reads identity/clock-state from storage.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { type ActiveGeofence } from "../../lib/attendanceApi";
import { enqueuePing, type QueuedPing } from "./pingQueue";
import { syncPings } from "./pingSync";
import { loadQueue } from "./queue";
import { getWifi } from "./wifi";

export const PING_TASK = "fixflow-attendance-pings";

// Mirrors the keys the rest of the slice uses (headless context can't reach the
// auth/attendance React state, so it reads storage directly).
const TECH_KEY = "fixflow_tech";
const FENCE_CACHE_KEY = "attendance.geofence.cache.v1";
const DUTY_KEY = "attendance.duty.v1";
const DEFAULT_PING_INTERVAL_MIN = 5;

interface DutyState {
  techId: string;
  clockedIn: boolean;
}

async function getSignedInTechId(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TECH_KEY);
    if (!raw) return null;
    return (JSON.parse(raw) as { id?: string }).id ?? null;
  } catch {
    return null;
  }
}

async function writeDuty(state: DutyState): Promise<void> {
  try {
    await AsyncStorage.setItem(DUTY_KEY, JSON.stringify(state));
  } catch {
    // best-effort — the queue + geofence still function without the cache
  }
}

async function readDuty(): Promise<DutyState | null> {
  try {
    const raw = await AsyncStorage.getItem(DUTY_KEY);
    return raw ? (JSON.parse(raw) as DutyState) : null;
  } catch {
    return null;
  }
}

/**
 * Is this tech currently on duty? The freshest signal is their latest LOCAL
 * punch (still in the queue); once that's synced-and-pruned we fall back to the
 * cached truth (written by start/stop), which survives an app kill so the
 * tracker can re-arm on relaunch.
 */
export async function isOnDuty(techId: string): Promise<boolean> {
  try {
    const mine = (await loadQueue()).filter((p) => p.tech_id === techId);
    if (mine.length > 0) {
      const latest = mine.reduce((a, b) => (a.device_time >= b.device_time ? a : b));
      return latest.kind === "clock_in";
    }
  } catch {
    // fall through to the cache
  }
  const duty = await readDuty();
  return duty?.techId === techId ? duty.clockedIn : false;
}

async function pingIntervalMs(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(FENCE_CACHE_KEY);
    const fence = raw ? (JSON.parse(raw) as ActiveGeofence | null) : null;
    const minutes = fence?.ping_interval_minutes ?? DEFAULT_PING_INTERVAL_MIN;
    return Math.max(minutes, 1) * 60 * 1000;
  } catch {
    return DEFAULT_PING_INTERVAL_MIN * 60 * 1000;
  }
}

async function isRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(PING_TASK);
  } catch {
    return false;
  }
}

/** Begin interval sampling. Records the on-duty cache, then arms the OS task
 * (idempotent — a no-op if already running). Never throws. */
export async function startDutyPings(techId: string): Promise<void> {
  await writeDuty({ techId, clockedIn: true });
  try {
    if (await isRunning()) return;
    const interval = await pingIntervalMs();
    await Location.startLocationUpdatesAsync(PING_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: interval,
      deferredUpdatesInterval: interval,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "FixFlow — on duty",
        notificationBody: "Your location is being recorded while you are clocked in.",
      },
    });
  } catch {
    // best-effort — a start failure must never crash the app
  }
}

/** The privacy hard-stop. Marks off-duty (if we know who), then stops the OS
 * task. NEVER throws — clock-out/logout must not depend on it succeeding. */
export async function stopDutyPings(techId?: string): Promise<void> {
  if (techId) await writeDuty({ techId, clockedIn: false });
  try {
    if (await isRunning()) await Location.stopLocationUpdatesAsync(PING_TASK);
  } catch {
    // ignore — a stop failure is retried on the next reconcile
  }
}

/**
 * Idempotent reconcile: bring the OS task in line with the current clock state.
 * Called on launch/foreground (reboot / app-kill re-arm) — mirrors
 * `ensureGeofenceMonitoring`. On-duty ∧ not-running → start; off-duty (or nobody
 * signed in) ∧ running → stop.
 */
export async function ensurePingTracking(): Promise<void> {
  const techId = await getSignedInTechId();
  const running = await isRunning();
  if (!techId) {
    if (running) await stopDutyPings();
    return;
  }
  const onDuty = await isOnDuty(techId);
  if (onDuty && !running) await startDutyPings(techId);
  else if (!onDuty && running) await stopDutyPings(techId);
}

/**
 * Decide-and-act on a batch of location updates. Exported for unit tests — the
 * OS task is a thin wrapper around this (mirrors geofence's `handleGeofenceEvent`).
 * Enforces privacy layer 2: a fix that arrives while off-duty (or with nobody
 * signed in) is DISCARDED and the sampler is stopped — never recorded.
 */
export async function handlePingUpdate(locations: Location.LocationObject[]): Promise<void> {
  const techId = await getSignedInTechId();
  if (!techId) {
    await stopDutyPings(); // nobody signed in — stop, record nothing
    return;
  }
  if (!(await isOnDuty(techId))) {
    await stopDutyPings(techId); // off the clock — stop and discard the fix
    return;
  }
  const fix = locations[locations.length - 1]; // the freshest sample
  if (!fix) return;
  const wifi = await getWifi();
  const item: QueuedPing = {
    client_id: Crypto.randomUUID(),
    tech_id: techId,
    shop_id: "default",
    captured_at: new Date(fix.timestamp).toISOString(), // device clock = analytical axis
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracy_m: fix.coords.accuracy ?? null,
    is_mock_location: fix.mocked ?? false,
    wifi_bssid: wifi.wifi_bssid,
    wifi_ssid: wifi.wifi_ssid,
    done: false,
    created_at: new Date().toISOString(),
  };
  await enqueuePing(item); // local write = never lost (subject to the queue cap)
  void syncPings(techId); // best-effort flush; retries on later triggers
}

// Register the headless task at module load (imported from `index.ts` so it's
// defined before any background invocation, exactly like the geofence task).
TaskManager.defineTask(PING_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
  await handlePingUpdate(locations);
});
