/**
 * The web app's shared HTTP client. Dependency-free (just `fetch`), so it lives
 * in the shared kernel. Feature modules build their typed calls on `apiGet` /
 * `apiSend`.
 *
 * Auth: the login JWT is kept in localStorage and attached as a Bearer header on
 * every request. A 401 clears the token and notifies a registered handler (the
 * AuthProvider) so the app drops back to the login screen.
 *
 * Base URL is build-time config: set `VITE_API_URL` to point at the backend.
 */

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const TOKEN_KEY = "fixflow_token";

function store() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function getToken() {
  return store()?.getItem(TOKEN_KEY) ?? null;
}

export function setToken(token) {
  const s = store();
  if (!s) return;
  if (token) s.setItem(TOKEN_KEY, token);
  else s.removeItem(TOKEN_KEY);
}

let onUnauthorized = null;
/** Register a callback fired when any request gets a 401 (token already cleared). */
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function handle(res, method, path) {
  if (res.status === 401) {
    setToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export async function apiGet(path) {
  const res = await fetch(`${apiUrl}${path}`, { headers: { ...authHeaders() } });
  return handle(res, "GET", path);
}

export async function apiSend(path, method, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return handle(res, method, path);
}
