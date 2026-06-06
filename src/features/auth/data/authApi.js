/**
 * Auth endpoints on the shared client. `login` persists the returned JWT so all
 * subsequent `apiGet`/`apiSend` calls carry it automatically.
 */

import { apiGet, apiSend, setToken } from "@shared/lib/api";

/** Public roster for the login picker (no PINs). */
export function fetchTechnicians() {
  return apiGet("/api/technicians");
}

/** Exchange a tech id + PIN for a token; returns the technician profile. */
export async function login(techId, pin) {
  const res = await apiSend("/api/auth/login", "POST", { tech_id: techId, pin });
  setToken(res.token);
  return res.technician;
}

/** Rehydrate the current caller from a stored token (also validates it). */
export function me() {
  return apiGet("/api/auth/me");
}
