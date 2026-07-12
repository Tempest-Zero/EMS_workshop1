/**
 * Auth endpoints on the shared client. `login` persists the returned JWT so all
 * subsequent `apiGet`/`apiSend` calls carry it automatically.
 */

import { apiGet, apiSend, setToken } from "@shared/lib/api";

/** Public roster for the login picker (no PINs). */
export function fetchTechnicians() {
  return apiGet("/api/technicians/roster");
}

/** Exchange a username + password for a token; returns the technician profile. */
export async function login(username, password) {
  const res = await apiSend("/api/auth/login", "POST", { username, password });
  setToken(res.token);
  return res.technician;
}

/** Force password change on first login. */
export async function changePassword(newPassword) {
  return apiSend("/api/technicians/password", "POST", { password: newPassword });
}

/** Rehydrate the current caller from a stored token (also validates it). */
export function me() {
  return apiGet("/api/auth/me");
}
