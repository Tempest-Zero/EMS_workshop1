/**
 * The geofence-exit "start travel?" nudge — the front half of the fuel-honesty
 * fix. When the tech leaves the workshop with an assigned visit/pickup job that
 * has no depart punch yet, the breadcrumb sampler is what makes the route (and
 * so the fuel bill) real — but it only arms when they tap START TRAVEL. This
 * reminds them to. Deliberately best-effort and debounced: a missed nudge just
 * falls back to the workshop-origin straight-line estimate (server-side), never
 * a hard error, never a nag.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { loadJobDetail, loadJobsList } from "../../lib/jobsCache";
import type { Job } from "../../lib/jobsApi";
import { hasActiveTravel } from "./travelTracker";

export const TRAVEL_CHANNEL = "travel";
const LAST_PROMPT_KEY = "jobs.travelPrompt.last.v1";
// At most one nudge an hour — a tech running errands in/out of the fence must
// not get spammed.
const PROMPT_DEBOUNCE_MS = 60 * 60 * 1000;

export interface TravelPromptData {
  type: "travel_prompt";
  /** Set only when exactly one job qualifies → the tap deep-links its Travel
   * screen. Absent when several qualify → the tap opens the jobs hub. */
  id?: string;
  token?: number;
}

async function ensureTravelChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(TRAVEL_CHANNEL, {
    name: "Travel reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

async function isDebounced(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PROMPT_KEY);
    return raw ? Date.now() - Number(raw) < PROMPT_DEBOUNCE_MS : false;
  } catch {
    return false;
  }
}

/** A job the tech should be travelling to: assigned to them, still open, and a
 * type the shop travels for. */
function isTravelCandidate(job: Job, techId: string): boolean {
  return job.assigned_tech_id === techId && job.status === "open" && job.job_type !== "carry-in";
}

/**
 * On a confirmed workshop exit, nudge the tech to start travel if a qualifying
 * job has no depart punch recorded yet. Reads only local caches (offline-safe).
 */
export async function maybePromptTravel(techId: string): Promise<void> {
  try {
    if (await hasActiveTravel()) return; // already recording a leg — no nudge
    if (await isDebounced()) return;

    const cached = await loadJobsList();
    if (!cached) return;
    const candidates = cached.data.filter((j) => isTravelCandidate(j, techId));
    if (candidates.length === 0) return;

    // Drop any candidate we can PROVE already departed (its cached detail shows
    // a depart_workshop punch). No cached detail → keep it; worst case the
    // Travel screen just opens on the arrive state.
    const pending: Job[] = [];
    for (const j of candidates) {
      const detail = await loadJobDetail(j.id);
      const departed = detail?.data.locations.some((l) => l.kind === "depart_workshop") ?? false;
      if (!departed) pending.push(j);
    }
    if (pending.length === 0) return;

    await ensureTravelChannel();
    const single = pending.length === 1 ? pending[0] : null;
    const data: TravelPromptData = single
      ? { type: "travel_prompt", id: single.id, token: single.token }
      : { type: "travel_prompt" };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: single ? `Heading to job #${single.token}?` : "Heading to a job?",
        body: "Tap to start travel so your route is recorded for the fuel bill.",
        data,
      },
      trigger: Platform.OS === "android" ? { channelId: TRAVEL_CHANNEL, seconds: 1 } : null,
    });
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
  } catch {
    // best-effort — a missed nudge is fine; the fuel estimate stands in
  }
}
