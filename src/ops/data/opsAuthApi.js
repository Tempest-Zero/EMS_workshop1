/**
 * Auth for the standalone ops console: a single shared team password, exchanged
 * for a short-lived session token by the ops server (ops-server.mjs). The token
 * is then carried as a Bearer header on every /api/ops/* call via @shared/lib/api.
 * No FixFlow account, no customer DB — this app is fully self-contained.
 */

import { apiSend } from "@shared/lib/api";

/** Exchange the shared password for a session token: { token }. */
export function login(password) {
  return apiSend("/api/ops/login", "POST", { password });
}
