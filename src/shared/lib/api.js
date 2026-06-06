/**
 * The web app's shared HTTP client — the first web→API integration. Dependency-
 * free (just `fetch`), so it belongs in the shared kernel. Feature modules build
 * their typed calls on top of `apiGet` / `apiSend` (see
 * `features/attendance/data/attendanceApi.js`).
 *
 * The base URL is build-time config: set `VITE_API_URL` in `.env` (or the deploy
 * env) to point at the FastAPI backend. CORS already allows the Vite dev origin.
 */

export const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function handle(res, method, path) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return undefined;
  return res.json();
}

export async function apiGet(path) {
  return handle(await fetch(`${apiUrl}${path}`), "GET", path);
}

export async function apiSend(path, method, body) {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
  });
  return handle(res, method, path);
}
