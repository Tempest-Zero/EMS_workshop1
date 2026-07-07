/**
 * The clock-in/out pipeline. Captures the evidence (selfie + GPS + mock flag +
 * WiFi), writes the punch to the local queue, and returns immediately — the UI
 * shows success without waiting for the network. A background sync is kicked off
 * fire-and-forget; if offline it simply stays queued.
 */

import * as Crypto from "expo-crypto";

import { enqueue, type QueuedPunch } from "./queue";
import { getLocation } from "./location";
import { startDutyPings, stopDutyPings } from "./pingTracker";
import { captureSelfie } from "./selfie";
import { syncNow } from "./sync";
import { getWifi } from "./wifi";

export interface PunchInput {
  techId: string;
  kind: QueuedPunch["kind"];
  shopId?: string;
  withSelfie?: boolean; // default true
}

export async function punch(input: PunchInput): Promise<QueuedPunch> {
  // Selfie first (the interactive step); GPS + WiFi are quick and parallel.
  const selfie = input.withSelfie === false ? null : await captureSelfie();
  const [loc, wifi] = await Promise.all([getLocation(), getWifi()]);

  const now = new Date().toISOString();
  const item: QueuedPunch = {
    client_id: Crypto.randomUUID(),
    tech_id: input.techId,
    shop_id: input.shopId ?? "default",
    kind: input.kind,
    device_time: now,
    lat: loc.lat,
    lng: loc.lng,
    accuracy_m: loc.accuracy_m,
    is_mock_location: loc.is_mock_location,
    wifi_bssid: wifi.wifi_bssid,
    wifi_ssid: wifi.wifi_ssid,
    selfie_uri: selfie?.uri ?? null,
    selfie_filename: selfie?.filename ?? null,
    selfie_content_type: selfie?.contentType ?? null,
    server_event_id: null,
    selfie_done: false,
    done: false,
    created_at: now,
  };

  await enqueue(item); // local write = instant success
  // On-duty ping tracking follows the clock: start interval sampling on
  // clock-in; on clock-out AWAIT the stop first — the privacy hard-stop must
  // take effect before anything else (even the sync) proceeds.
  if (input.kind === "clock_in") void startDutyPings(input.techId);
  else await stopDutyPings(input.techId);
  void syncNow(input.techId); // fire-and-forget background sync
  return item;
}
