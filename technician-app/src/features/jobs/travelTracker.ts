/**
 * Job-travel breadcrumb tracking (the mobile half of the 0035 contract).
 * Between the depart-workshop and arrive-customer punches, the OS samples the
 * phone's location and a headless TaskManager task queues each fix as an
 * outbound breadcrumb — the server path-sums trusted samples into the actual
 * driven distance, upgrading the fuel line from the circuity estimate.
 *
 * PRIVACY mirrors the on-duty ping tracker's layers:
 *   1. the arrival punch awaits `stopJobTravel()` before anything else,
 *   2. the task body self-stops + discards the fix when no travel is active,
 *   3. logout / 401 stops it (AuthContext),
 *   4. a MAX-DURATION failsafe: a travel session over MAX_TRAVEL_MS
 *      auto-stops and refuses to re-arm — a forgotten arrival punch must not
 *      track a tech all day.
 * The foreground-service notification keeps the sampling visible. Headless
 * context — identity/state come from storage, never React.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { enqueueTravelSample, type QueuedTravelSample } from "./travelQueue";
import { syncTravelSamples } from "./travelSync";

export const TRAVEL_TASK = "fixflow-job-travel";

const TECH_KEY = "fixflow_tech";
const TRAVEL_KEY = "jobs.travel.active.v1";

// One leg of a Karachi home visit should never be hours — past this the
// session is assumed to be a forgotten arrival punch and sampling stops.
export const MAX_TRAVEL_MS = 4 * 60 * 60 * 1000;

// ~20s between fixes keeps a 30-min drive under ~100 samples (one batch).
const SAMPLE_INTERVAL_MS = 20_000;
const SAMPLE_DISTANCE_M = 50;

interface TravelState {
  jobId: string;
  techId: string;
  startedAt: string; // ISO — drives the max-duration failsafe
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

async function readTravel(): Promise<TravelState | null> {
  try {
    const raw = await AsyncStorage.getItem(TRAVEL_KEY);
    return raw ? (JSON.parse(raw) as TravelState) : null;
  } catch {
    return null;
  }
}

async function writeTravel(state: TravelState | null): Promise<void> {
  try {
    if (state) await AsyncStorage.setItem(TRAVEL_KEY, JSON.stringify(state));
    else await AsyncStorage.removeItem(TRAVEL_KEY);
  } catch {
    // best-effort
  }
}

function expired(state: TravelState): boolean {
  const started = Date.parse(state.startedAt);
  return Number.isFinite(started) && Date.now() - started > MAX_TRAVEL_MS;
}

/** True when a breadcrumb leg is currently armed (and not past the failsafe).
 * Used to suppress the geofence "start travel?" nudge — we're already
 * recording a route. Never throws. */
export async function hasActiveTravel(): Promise<boolean> {
  const state = await readTravel();
  return state !== null && !expired(state);
}

async function isRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TRAVEL_TASK);
  } catch {
    return false;
  }
}

/** Arm breadcrumb sampling for a job's outbound leg (idempotent). Called by
 * the travel screen's START TRAVEL punch. Never throws. */
export async function startJobTravel(jobId: string, techId: string): Promise<void> {
  const existing = await readTravel();
  const continuing = existing?.jobId === jobId && existing.techId === techId;
  await writeTravel({
    jobId,
    techId,
    startedAt: continuing ? existing.startedAt : new Date().toISOString(),
  });
  try {
    if (await isRunning()) return;
    await Location.startLocationUpdatesAsync(TRAVEL_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: SAMPLE_INTERVAL_MS,
      distanceInterval: SAMPLE_DISTANCE_M,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "FixFlow — travelling to job",
        notificationBody: "Your route is being recorded for the travel/fuel bill.",
      },
    });
  } catch {
    // best-effort — the straight-line estimate stands in when sampling fails
  }
}

/** The privacy hard-stop. Clears the active-travel state, stops the OS task,
 * and kicks a final drain. NEVER throws. */
export async function stopJobTravel(techId?: string | null): Promise<void> {
  const state = await readTravel();
  await writeTravel(null);
  try {
    if (await isRunning()) await Location.stopLocationUpdatesAsync(TRAVEL_TASK);
  } catch {
    // ignore — retried by the next reconcile
  }
  const drainAs = techId ?? state?.techId ?? null;
  if (drainAs) void syncTravelSamples(drainAs);
}

/** Idempotent reconcile (launch/foreground): active travel ∧ not running →
 * re-arm; no travel (or expired / signed out) ∧ running → stop. */
export async function ensureTravelTracking(): Promise<void> {
  const techId = await getSignedInTechId();
  const state = await readTravel();
  const running = await isRunning();
  if (!techId || !state || state.techId !== techId || expired(state)) {
    if (running || state) await stopJobTravel(techId);
    return;
  }
  if (!running) await startJobTravel(state.jobId, techId);
}

/** Task body — exported for unit tests (mirrors handlePingUpdate). A fix that
 * arrives with no active travel (or past the cap) is DISCARDED. */
export async function handleTravelUpdate(
  locations: Location.LocationObject[],
): Promise<void> {
  const techId = await getSignedInTechId();
  if (!techId) {
    await stopJobTravel();
    return;
  }
  const state = await readTravel();
  if (!state || state.techId !== techId) {
    await stopJobTravel(techId);
    return;
  }
  if (expired(state)) {
    await stopJobTravel(techId); // the failsafe — forgotten arrival punch
    return;
  }
  for (const fix of locations) {
    const item: QueuedTravelSample = {
      client_id: Crypto.randomUUID(),
      job_id: state.jobId,
      tech_id: techId,
      leg: "outbound",
      lat: fix.coords.latitude,
      lng: fix.coords.longitude,
      accuracy_m: fix.coords.accuracy ?? null,
      is_mock: fix.mocked ?? false,
      captured_at: new Date(fix.timestamp).toISOString(),
      done: false,
      created_at: new Date().toISOString(),
    };
    await enqueueTravelSample(item);
  }
  void syncTravelSamples(techId); // best-effort flush; retries on later triggers
}

// Register the headless task at module load (side-imported from index.ts so
// it exists before any background invocation — same as geofence/pings).
TaskManager.defineTask(TRAVEL_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | null)?.locations ?? [];
  await handleTravelUpdate(locations);
});
