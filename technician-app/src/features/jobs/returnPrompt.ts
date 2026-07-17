/**
 * The geofence-ENTER "back at the workshop?" nudge — the return-leg twin of
 * `travelPrompt`. When the tech re-enters the workshop fence while a RETURN
 * breadcrumb leg is armed, the arrive_workshop punch is what closes the leg
 * (and stops the sampler) — but it only lands when they tap I'M BACK. This
 * reminds them to. Best-effort and debounced like its twin: a missed nudge
 * just means the 4-hour failsafe eventually stops sampling and the return
 * falls back to the estimate.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { loadJobDetail } from "../../lib/jobsCache";
import { getActiveTravel } from "./travelTracker";
import { TRAVEL_CHANNEL } from "./travelPrompt";

const LAST_PROMPT_KEY = "jobs.returnPrompt.last.v1";
// Boundary jitter can re-fire Enter; one nudge per window is plenty.
const PROMPT_DEBOUNCE_MS = 10 * 60 * 1000;

export interface ReturnPromptData {
  type: "return_prompt";
  id: string;
  token: number;
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

/**
 * On a confirmed workshop ENTER, nudge the tech to punch their return when a
 * return breadcrumb leg is armed. Reads only local state (offline-safe).
 */
export async function maybePromptReturn(_techId: string): Promise<void> {
  try {
    const active = await getActiveTravel();
    if (!active || active.leg !== "return") return; // not driving back — silent
    if (await isDebounced()) return;

    const detail = await loadJobDetail(active.jobId);
    const token = detail?.data.token;
    if (token == null) return; // no cached token to deep-link — stay silent

    await ensureTravelChannel();
    const data: ReturnPromptData = { type: "return_prompt", id: active.jobId, token };
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Back at the workshop?",
        body: `Tap to punch your return for job #${token} — that closes the travel record.`,
        data,
      },
      trigger: Platform.OS === "android" ? { channelId: TRAVEL_CHANNEL, seconds: 1 } : null,
    });
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
  } catch {
    // best-effort — the max-duration failsafe still bounds the sampler
  }
}
