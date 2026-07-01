/**
 * Standalone Ops Console server — a self-contained monitoring app.
 *
 * This is the BFF for the read-only ops console. It is DELIBERATELY decoupled
 * from the FixFlow backend and database: it holds the Railway/Sentry tokens
 * itself and proxies them, checks the main app's health by pinging its public
 * endpoints, and gates access with a single shared team password. Nothing here
 * touches customer data — worst case it breaks, it breaks only this service.
 *
 * One Node process (zero npm deps — Node 20+ built-ins only) serves both the
 * built SPA (dist-ops/) and the /api/ops/* JSON the SPA calls.
 *
 * Env (set as Railway service variables on the `ops` service):
 *   OPS_PASSWORD              shared team password (required to log in)
 *   OPS_SESSION_SECRET        HMAC key for session tokens (optional; random per boot if unset)
 *   OPS_RAILWAY_TOKEN         Railway API token (held server-side ONLY; non-reserved name)
 *   OPS_RAILWAY_PROJECT_ID    optional — defaults to Railway's injected RAILWAY_PROJECT_ID
 *   OPS_RAILWAY_ENV_ID        optional — defaults to Railway's injected RAILWAY_ENVIRONMENT_ID
 *   OPS_HEALTH_TARGETS        comma list of name|url to ping, e.g. "backend|https://…/api/health,web|https://…/"
 *   OPS_BACKEND_URL           FixFlow backend base URL for the deep-health + metrics proxy, e.g. "https://…"
 *   OPS_PROXY_TOKEN           shared secret sent to the backend as X-Ops-Proxy-Token (must equal FIXFLOW_OPS_PROXY_TOKEN)
 *   SENTRY_AUTH_TOKEN         Sentry read token (optional)
 *   SENTRY_ORG                Sentry org slug (optional)
 *   SENTRY_PROJECTS           comma list of label|slug (optional), e.g. "web|fixflow-web,backend|fixflow-api"
 *   PORT                      injected by Railway (default 8080)
 */

import http from "node:http";
import crypto from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || 8080;
const DIST = path.resolve("dist-ops");
// The Vite entry builds to ops.html; serve whichever shell exists as the SPA root.
const SHELL = existsSync(path.join(DIST, "index.html")) ? "index.html" : "ops.html";

const OPS_PASSWORD = process.env.OPS_PASSWORD || "";
const SESSION_SECRET = process.env.OPS_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12h; redeploy invalidates (random secret)

// Token comes from OPS_RAILWAY_TOKEN (a non-reserved name we set ourselves).
// Project/env IDs default to the values Railway auto-injects into every service,
// so on Railway we only have to set the token. All have explicit overrides too.
const RAILWAY_TOKEN = process.env.OPS_RAILWAY_TOKEN || process.env.RAILWAY_API_TOKEN || "";
const RAILWAY_PROJECT_ID =
  process.env.OPS_RAILWAY_PROJECT_ID || process.env.RAILWAY_PROJECT_ID || "";
const RAILWAY_ENV_ID = process.env.OPS_RAILWAY_ENV_ID || process.env.RAILWAY_ENVIRONMENT_ID || "";
const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";
const RAILWAY_CONFIGURED = Boolean(RAILWAY_TOKEN && RAILWAY_PROJECT_ID && RAILWAY_ENV_ID);

const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN || "";
const SENTRY_ORG = process.env.SENTRY_ORG || "";
const SENTRY_PROJECTS = (process.env.SENTRY_PROJECTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const [label, slug] = pair.split("|");
    return { label: (label || "").trim(), slug: (slug || "").trim() };
  })
  .filter((p) => p.label && p.slug);
const SENTRY_CONFIGURED = Boolean(SENTRY_TOKEN && SENTRY_ORG && SENTRY_PROJECTS.length);

// Backend deep-health + in-app metrics proxy. The ops server fans these two
// surfaces out to the FixFlow backend (the only thing that can probe the DB /
// scheduler / migrations and tally per-route latency), authenticating with a
// shared secret. Empty = those surfaces report "not configured" / a degraded row.
const OPS_BACKEND_URL = (process.env.OPS_BACKEND_URL || "").replace(/\/+$/, "");
const OPS_PROXY_TOKEN = process.env.OPS_PROXY_TOKEN || "";
const BACKEND_PROXY_CONFIGURED = Boolean(OPS_BACKEND_URL && OPS_PROXY_TOKEN);
const EMPTY_METRICS = {
  uptime_seconds: 0,
  started_at: 0,
  total_requests: 0,
  in_flight: 0,
  error_rate: 0,
  routes: [],
};

const HEALTH_TARGETS = (process.env.OPS_HEALTH_TARGETS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair) => {
    const [name, url] = pair.split("|");
    return { name: (name || "").trim(), url: (url || "").trim() };
  })
  .filter((t) => t.name && t.url);

// ── Auth: shared password → stateless HMAC session token ─────────────────────
function issueToken() {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

function tokenValid(token) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(exp).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

// ── Tiny TTL cache so the UI's polling can't hammer Railway's rate limit ──────
const CACHE_TTL_MS = 20_000;
const cache = new Map();
async function cached(key, factory) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await factory();
  cache.set(key, { exp: Date.now() + CACHE_TTL_MS, val });
  return val;
}

// ── Railway proxy ────────────────────────────────────────────────────────────
async function railwayGraphQL(query, variables) {
  const res = await fetch(RAILWAY_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${RAILWAY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Railway HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Railway: ${json.errors[0]?.message || "error"}`);
  if (!json.data) throw new Error("Railway returned no data");
  return json.data;
}

const Q_SERVICES = `query($e:String!){environment(id:$e){serviceInstances{edges{node{serviceId serviceName latestDeployment{id status createdAt}}}}}}`;
const Q_DEPLOYS = `query($p:String!,$e:String!,$s:String!){deployments(first:20,input:{projectId:$p,environmentId:$e,serviceId:$s}){edges{node{id status createdAt meta}}}}`;
// environmentLogs is environment-wide and cross-deployment (filterable by
// @service:<id>), so the tail spans redeploys instead of resetting each time —
// validated against the live API. deploymentLogs (latest deployment only) is
// kept as a fallback for schema drift. Retention is Railway's plan cap either way.
const Q_ENV_LOGS = `query($e:String!,$f:String,$l:Int){environmentLogs(environmentId:$e,filter:$f,beforeLimit:$l){timestamp message severity}}`;
const Q_DEPLOY_LOGS = `query($d:String!,$l:Int,$f:String){deploymentLogs(deploymentId:$d,limit:$l,filter:$f){timestamp message severity}}`;
const Q_METRICS = `query($p:String!,$e:String!,$s:String!,$start:DateTime!,$m:[MetricMeasurement!]!){metrics(projectId:$p,environmentId:$e,serviceId:$s,startDate:$start,measurements:$m,sampleRateSeconds:300){measurement values{ts value}}}`;
const MEASUREMENTS = ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_RX_GB", "NETWORK_TX_GB"];

async function serviceNodes() {
  return cached("nodes", async () => {
    const data = await railwayGraphQL(Q_SERVICES, { e: RAILWAY_ENV_ID });
    return (data.environment?.serviceInstances?.edges || []).map((x) => x.node || {});
  });
}

async function resolveServiceId(name) {
  for (const n of await serviceNodes()) {
    if (String(n.serviceName).toLowerCase() === String(name).toLowerCase()) return n.serviceId;
  }
  throw new Error(`unknown Railway service '${name}'`);
}

async function latestDeploymentId(name) {
  for (const n of await serviceNodes()) {
    if (String(n.serviceName).toLowerCase() === String(name).toLowerCase())
      return n.latestDeployment?.id || null;
  }
  return null;
}

async function railwayServices() {
  const nodes = await serviceNodes();
  return nodes.map((n) => ({
    id: n.serviceId,
    name: n.serviceName,
    latest_status: n.latestDeployment?.status ?? null,
    latest_at: n.latestDeployment?.createdAt ?? null,
  }));
}

async function railwayDeployments(name) {
  const s = await resolveServiceId(name);
  return cached(`dep:${s}`, async () => {
    const data = await railwayGraphQL(Q_DEPLOYS, { p: RAILWAY_PROJECT_ID, e: RAILWAY_ENV_ID, s });
    return (data.deployments?.edges || []).map((x) => {
      const node = x.node || {};
      const meta = node.meta || {};
      return {
        id: node.id,
        status: node.status || "UNKNOWN",
        created_at: node.createdAt ?? null,
        commit_sha: meta.commitHash ? String(meta.commitHash) : null,
        commit_message: meta.commitMessage ? String(meta.commitMessage) : null,
      };
    });
  });
}

function mapLogRows(rows) {
  return (rows || []).map((r) => ({
    timestamp: r.timestamp ?? null,
    severity: r.severity ?? null,
    message: String(r.message ?? ""),
  }));
}

// Latest-deployment-only logs — the fallback path if environmentLogs ever drifts.
async function deploymentLogsFor(name, limit, filter) {
  const d = await latestDeploymentId(name);
  if (!d) throw new Error(`no deployment for service '${name}'`);
  const data = await railwayGraphQL(Q_DEPLOY_LOGS, { d, l: limit, f: filter || null });
  return mapLogRows(data.deploymentLogs);
}

async function railwayLogs(name, limit, filter) {
  const s = await resolveServiceId(name);
  // Environment-wide, scoped to this service → cross-deployment history. Railway
  // filters are space-separated AND terms, so append any user search to the scope.
  const scoped = filter ? `@service:${s} ${filter}` : `@service:${s}`;
  return cached(`log:${s}:${limit}:${filter || ""}`, async () => {
    try {
      const data = await railwayGraphQL(Q_ENV_LOGS, { e: RAILWAY_ENV_ID, f: scoped, l: limit });
      return mapLogRows(data.environmentLogs);
    } catch {
      // Schema drift / unexpected shape — degrade to the latest deployment's tail.
      return deploymentLogsFor(name, limit, filter);
    }
  });
}

async function railwayMetrics(name, hours) {
  const s = await resolveServiceId(name);
  const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  return cached(`met:${s}:${hours}`, async () => {
    const data = await railwayGraphQL(Q_METRICS, {
      p: RAILWAY_PROJECT_ID,
      e: RAILWAY_ENV_ID,
      s,
      start,
      m: MEASUREMENTS,
    });
    return (data.metrics || []).map((entry) => ({
      measurement: entry.measurement || "",
      points: (entry.values || [])
        .filter((v) => v.ts != null)
        .map((v) => ({ ts: new Date(v.ts).toISOString(), value: Number(v.value) || 0 })),
    }));
  });
}

// ── Sentry proxy ─────────────────────────────────────────────────────────────
async function sentryIssues(project) {
  const targets = project ? SENTRY_PROJECTS.filter((p) => p.label === project) : SENTRY_PROJECTS;
  const out = [];
  for (const { label, slug } of targets) {
    const url = `https://sentry.io/api/0/projects/${SENTRY_ORG}/${slug}/issues/?query=is:unresolved&limit=25&statsPeriod=14d`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${SENTRY_TOKEN}` } });
    if (!res.ok) throw new Error(`Sentry HTTP ${res.status} for ${label}`);
    const rows = await res.json();
    for (const r of rows) {
      out.push({
        id: String(r.id),
        title: r.title || "",
        culprit: r.culprit ?? null,
        level: r.level ?? null,
        count: r.count != null ? Number(r.count) : null,
        user_count: r.userCount ?? null,
        last_seen: r.lastSeen ?? null,
        permalink: r.permalink ?? null,
        project: label,
      });
    }
  }
  out.sort((a, b) => new Date(b.last_seen || 0) - new Date(a.last_seen || 0));
  return out;
}

// ── Health: ping the main app + report integration wiring ────────────────────
async function pingTarget({ name, url }) {
  const start = performance.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "manual" });
    clearTimeout(t);
    const ms = Math.round(performance.now() - start);
    const ok = res.status > 0 && res.status < 500;
    return {
      name,
      status: ok ? "ok" : "down",
      latency_ms: ms,
      detail: `HTTP ${res.status} · ${url}`,
    };
  } catch (e) {
    return { name, status: "down", latency_ms: null, detail: `unreachable · ${e.name || "error"}` };
  }
}

// ── Backend deep-health + metrics proxy ──────────────────────────────────────
// Calls the FixFlow backend's read-only /api/ops/* with the shared secret. These
// are the surfaces a standalone app physically cannot produce (DB/scheduler/
// migrations probes, per-route latency) — the backend owns them, we just relay.
async function backendOps(pathname) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${OPS_BACKEND_URL}${pathname}`, {
      headers: { "X-Ops-Proxy-Token": OPS_PROXY_TOKEN },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`backend HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

// The backend's per-component rows (database / migrations / r2_storage /
// scheduler / config), merged into the health report. Backend down or
// unconfigured → ONE degraded row, never a crash.
async function backendHealthComponents() {
  if (!BACKEND_PROXY_CONFIGURED) {
    return [
      {
        name: "backend deep-health",
        status: "degraded",
        detail: "not configured (set OPS_BACKEND_URL + OPS_PROXY_TOKEN)",
      },
    ];
  }
  try {
    const report = await backendOps("/api/ops/health");
    return (report.components || []).map((c) => ({
      name: c.name,
      status: c.status,
      latency_ms: c.latency_ms ?? null,
      detail: c.detail ?? null,
    }));
  } catch (e) {
    const why = e.name === "AbortError" ? "timeout" : e.message || "error";
    return [{ name: "backend deep-health", status: "degraded", detail: `unreachable · ${why}` }];
  }
}

async function healthReport() {
  // Public reachability pings + the backend's deep per-dependency probes, in
  // parallel, then the integration-wiring rows.
  const [pings, backend] = await Promise.all([
    Promise.all(HEALTH_TARGETS.map(pingTarget)),
    backendHealthComponents(),
  ]);
  const components = [...pings, ...backend];
  components.push({
    name: "railway api",
    status: RAILWAY_CONFIGURED ? "ok" : "degraded",
    detail: RAILWAY_CONFIGURED ? "token configured" : "not configured",
  });
  components.push({
    name: "sentry",
    status: SENTRY_CONFIGURED ? "ok" : "degraded",
    detail: SENTRY_CONFIGURED ? "token configured" : "not configured",
  });
  const status = components.some((c) => c.status === "down")
    ? "down"
    : components.some((c) => c.status === "degraded")
      ? "degraded"
      : "ok";
  return { status, generated_at: new Date().toISOString(), components };
}

// In-app API metrics, proxied straight from the backend (envelope-wrapped so the
// UI's ProxyGate can tell "not configured" from "unavailable" from real data).
async function metricsReport() {
  if (!BACKEND_PROXY_CONFIGURED) {
    return {
      configured: false,
      available: false,
      detail: "Backend metrics proxy not configured (OPS_BACKEND_URL + OPS_PROXY_TOKEN).",
      ...EMPTY_METRICS,
    };
  }
  try {
    const m = await cached("metrics", () => backendOps("/api/ops/metrics"));
    return { configured: true, available: true, ...m };
  } catch (e) {
    return { configured: true, available: false, detail: String(e.message || e), ...EMPTY_METRICS };
  }
}

// ── Proxy envelope helpers ───────────────────────────────────────────────────
function unconfigured(extraKey) {
  return {
    configured: false,
    available: false,
    detail: "Not configured on this ops service.",
    [extraKey]: [],
  };
}
async function railwayEnvelope(extraKey, fn) {
  if (!RAILWAY_CONFIGURED) return unconfigured(extraKey);
  try {
    return { configured: true, available: true, [extraKey]: await fn() };
  } catch (e) {
    return { configured: true, available: false, detail: String(e.message || e), [extraKey]: [] };
  }
}

// ── HTTP plumbing ────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

function sendJson(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}");
  } catch {
    return {};
  }
}

async function serveStatic(req, res, pathname) {
  // Map "/" and unknown non-asset routes to the SPA shell.
  const rel = pathname === "/" ? `/${SHELL}` : pathname;
  let file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    return res.end("forbidden");
  }
  try {
    const s = await stat(file);
    if (s.isDirectory()) throw new Error("dir");
  } catch {
    file = path.join(DIST, SHELL); // SPA fallback
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname, searchParams } = url;

  if (!pathname.startsWith("/api/")) return serveStatic(req, res, pathname);

  // Login (unauthenticated)
  if (pathname === "/api/ops/login" && req.method === "POST") {
    const body = await readBody(req);
    if (!OPS_PASSWORD) return sendJson(res, 500, { error: "OPS_PASSWORD not set on the server" });
    const ok =
      typeof body.password === "string" &&
      body.password.length === OPS_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(body.password), Buffer.from(OPS_PASSWORD));
    if (!ok) return sendJson(res, 401, { error: "wrong password" });
    return sendJson(res, 200, { token: issueToken() });
  }

  // Everything else under /api requires a valid session token.
  if (!tokenValid(bearer(req))) return sendJson(res, 401, { error: "unauthorized" });

  try {
    if (pathname === "/api/ops/health") return sendJson(res, 200, await healthReport());
    if (pathname === "/api/ops/metrics") return sendJson(res, 200, await metricsReport());
    if (pathname === "/api/ops/railway/services")
      return sendJson(res, 200, await railwayEnvelope("services", railwayServices));
    if (pathname === "/api/ops/railway/deployments")
      return sendJson(
        res,
        200,
        await railwayEnvelope("deployments", () => railwayDeployments(searchParams.get("name")))
      );
    if (pathname === "/api/ops/railway/logs")
      return sendJson(
        res,
        200,
        await railwayEnvelope("lines", () =>
          railwayLogs(
            searchParams.get("name"),
            Number(searchParams.get("limit")) || 500,
            searchParams.get("filter")
          )
        )
      );
    if (pathname === "/api/ops/railway/metrics")
      return sendJson(
        res,
        200,
        await railwayEnvelope("series", () =>
          railwayMetrics(searchParams.get("name"), Number(searchParams.get("hours")) || 6)
        )
      );
    if (pathname === "/api/ops/sentry/issues") {
      if (!SENTRY_CONFIGURED) return sendJson(res, 200, unconfigured("issues"));
      try {
        const issues = await sentryIssues(searchParams.get("project") || undefined);
        return sendJson(res, 200, { configured: true, available: true, issues });
      } catch (e) {
        return sendJson(res, 200, {
          configured: true,
          available: false,
          detail: String(e.message || e),
          issues: [],
        });
      }
    }
    return sendJson(res, 404, { error: "not found" });
  } catch (e) {
    return sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`ops-server listening on :${PORT}`);
  console.log(
    `railway=${RAILWAY_CONFIGURED ? "on" : "off"} sentry=${SENTRY_CONFIGURED ? "on" : "off"} backend_proxy=${BACKEND_PROXY_CONFIGURED ? "on" : "off"} health_targets=${HEALTH_TARGETS.length} auth=${OPS_PASSWORD ? "on" : "OFF(no password!)"}`
  );
});
