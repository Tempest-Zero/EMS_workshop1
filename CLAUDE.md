# CLAUDE.md — ground truth for AI agents

**Read this first, and trust it over prose docs.** The long-form docs
(`ARCHITECTURE.md`, `docs/*`) explain the _why_ but drift over time. This file is the
**authoritative, current statement of what the stack actually is**. When this file and a
prose doc disagree, this file + the code win — and you should fix the prose doc (see
"Keeping this file honest" at the bottom).

> This file exists because agents (and humans) kept assuming a generic template —
> WatermelonDB, Supabase-native, GoTrue — none of which this project uses. Don't.

---

## What FixFlow is

A workshop management system for a home-appliance repair shop (Karachi). A **modular
monolith** in one monorepo, delivered as **three runtimes** that share a vertical-slice
layout (the same capability is a same-named folder in each runtime).

---

## The actual stack (verify before assuming anything else)

| Area                                               | Reality                                                                                                                                                                                                                                                                                                                                      | Not                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Web manager** (`src/`)                           | React 19 + Vite 6 + Tailwind 4 + React Router 7; Vitest + Testing Library; state in one React Context (`src/app/providers/AppContext.jsx`)                                                                                                                                                                                                   | —                                                                                                         |
| **Ops console** (`src/ops/` + `src/features/ops/`) | Standalone **read-only** monitoring app — a SECOND Vite build (`vite.ops.config.js` → `ops.html` → `dist-ops/`, `Dockerfile.ops`) deployed as its own Railway service (`ops`, `ops-server.mjs`). Surfaces **backend-proxied** deep-health + in-app API metrics (the two surfaces only the backend can produce), plus **ops-server-proxied** Railway logs/deploys/metrics + Sentry issues. Gated by a shared **proxy token** (`X-Ops-Proxy-Token`), not a DB role | NOT bundled into the manager app; the manager backend never holds Railway/Sentry tokens — the ops server does |
| **Mobile** (`technician-app/`)                     | Expo **SDK 52**, React Native 0.76.9, **Android-only**, TypeScript strict, Jest (`jest-expo`); needs an **EAS dev build** (not Expo Go). **Background geofencing** (`expo-task-manager` + `ACCESS_BACKGROUND_LOCATION`) drives the attendance arrival/exit prompts                                                                           | not iOS, not Expo Go                                                                                      |
| **Backend** (`backend/`)                           | **FastAPI** (Python 3.12), SQLAlchemy 2.0 **async** + asyncpg, **Alembic** migrations (head = **0037**; 38 tables), Pytest + pytest-asyncio, Ruff, Mypy strict, import-linter                                                                                                                                                                | not Django, not sync SQLAlchemy                                                                           |
| **Database**                                       | **Supabase = managed Postgres ONLY**, via the IPv4 **session pooler**; schema owned by **Alembic**                                                                                                                                                                                                                                           | **NOT** Supabase-native: no RLS, no GoTrue, no PostgREST, no Edge Functions, no pgTAP, no `supabase/` dir |
| **Auth**                                           | **Custom FastAPI JWT** — name/PIN login, PBKDF2-hashed PIN, `token_version` revocation, per-IP throttle + lockout (`backend/app/features/identity/`). Authorization enforced in the **service layer** (`CurrentPrincipal`/`CurrentManager`). Roles: `tech`, `manager`. (The ops console is gated separately by a shared proxy token, not a DB role.)                                    | **NOT** Supabase GoTrue                                                                                   |
| **Media bytes**                                    | **Cloudflare R2**, signed PUT, private bucket + signed GET ($0 egress). Phone never holds R2 creds                                                                                                                                                                                                                                           | **NOT** Supabase Storage                                                                                  |
| **Offline (mobile)**                               | **Hand-rolled**: jobs outbox (`technician-app/src/lib/outbox.ts`, `outboxSync.ts` — incl. the idempotent `create` kind), attendance punch queue + geofence-presence queue (`technician-app/src/features/attendance/{queue,sync,punch}.ts`, `{presenceQueue,presenceSync}.ts`), travel-breadcrumb queue (`features/jobs/{travelQueue,travelSync,travelTracker}.ts`), pending-media queue (`features/media/pendingMedia.ts` — voice notes waiting for their offline-created job), read cache (`lib/jobsCache.ts`) — all tested in plain Jest by mocking AsyncStorage/NetInfo/jobsApi | **NOT** WatermelonDB / Realm / a sync engine                                                              |
| **Sync model**                                     | Server is source of truth; client reconciles the returned row. Safety = **idempotency** (`client_id` dedupe) + **atomic conditional UPDATE** server-side (jobs `try_claim`)                                                                                                                                                                  | **NOT** bidirectional pull/push with conflict resolution                                                  |
| **Push**                                           | Firebase FCM                                                                                                                                                                                                                                                                                                                                 | —                                                                                                         |
| **Deploy**                                         | **Railway**, **manual `railway up`** (NOT GitHub-connected) — three services: `efficient-tenderness` (backend), `web`, `ops`. Mobile via **EAS Build**                                                                                                                                                                                       | not auto-deploy on merge                                                                                  |
| **CI**                                             | `.github/workflows/ci.yml` — 3 parallel jobs: frontend, backend, mobile                                                                                                                                                                                                                                                                      | —                                                                                                         |

---

## Do NOT assume (the things that keep biting)

- **No WatermelonDB / Realm / offline sync library.** Offline is the hand-rolled outbox above.
- **Supabase is a Postgres host, not a platform.** No RLS / GoTrue / PostgREST / pgTAP. The
  team evaluated Supabase-native and chose FastAPI (`docs/PLAYBOOK.md`).
- **Auth is custom FastAPI JWT, not GoTrue.** Test authorization in **pytest against real
  Postgres** (see `backend/tests/test_identity_integration.py`), never pgTAP/RLS.
- **Media is on R2, not Supabase Storage.**
- **The web app reads the LIVE API** for auth/jobs/attendance — not bundled mock seeds. (Only a
  few surfaces — schedule, the workshop-profile form — remain demo data, and are labeled in the UI.)
- **Effectively single-tenant today**: `shop_id` columns exist but the code uses a
  `DEFAULT_SHOP_ID` constant. Multi-customer is a _future_ goal — don't build for it as if it's live.
- **`expo export` (in CI) bundles JS only** — it does NOT catch native/Gradle compile breaks
  (e.g. a misconfigured Sentry gradle plugin). A real Android compile is currently _not_ gated.
- **The ops console is a SEPARATE deploy, not a manager-app page.** Its UI is `src/features/ops/`
  (kernel-only) wired by the `src/ops/` composition root (own auth/router, HashRouter) and built
  by `vite.ops.config.js`. The standalone **`ops-server.mjs`** (a zero-dep Node BFF) holds the
  Railway/Sentry tokens and proxies logs/deploys/metrics + Sentry issues itself. The only surfaces
  the **backend** exposes are **deep-health + in-app API metrics** (`backend/app/features/ops/`),
  gated by a shared secret in the `X-Ops-Proxy-Token` header (`settings.ops_proxy_token`, constant-
  time) — no DB role, no migration. In-app metrics come from `core/metrics.py` and are **in-memory,
  per-replica, reset on deploy** (not APM). There is **no** `core/railway.py`/`core/sentry_api.py` —
  the ops server owns those.

---

## Invariants you must respect when changing code

- **Money is integer minor units** (1 Rs = 100 paisa), never floats. Convert at the UI edge.
  Existing columns keep their `*_paisa` names (no churn on a live ledger); **new** money columns
  are named `*_minor` (the unit is `shop.currency`; seed `PKR` ⇒ paisa).
- **Mobile mutations go through the outbox** (`sendOrQueue`) and carry an idempotency
  `client_id`. Never `fetch` a write directly from a screen — that loses data offline and risks
  double-charging on retry.
- **Any `models.py` change needs a matching Alembic migration.** CI runs `alembic check` (drift)
  and `alembic upgrade head` against real Postgres. **FKs on populated tables** ship as
  `NOT VALID` then `VALIDATE CONSTRAINT` — same migration when the column is provably clean
  (seed precedes it / all-NULL new column), a **separate PR/deploy** when months of human data
  could hold orphans (`start.sh` runs all pending migrations at boot, so a same-deploy VALIDATE
  leaves no window to audit orphans). Seeds go in migrations; fuzzy backfills are idempotent
  dry-run-default scripts in `backend/scripts/` (run deliberately via `railway run`).
- **Respect slice boundaries.** Cross-slice access goes through `service.py`/`deps.py` (backend)
  or a feature's `index.js` barrel (web). CI enforces this (import-linter + ESLint
  `no-restricted-imports`); a new edge must be added to the allow-list consciously.
- **The outbox never deletes a write.** Success removes; definitive 4xx → visible "failed" list;
  anything ambiguous (offline/5xx/timeout) is kept and retried. Don't "simplify" this away. The
  attendance **punch and presence** queues and the **pending-media** queue carry the *same*
  contract (see `lib/syncClassification.ts`, shared with the jobs outbox). On-duty **pings and
  job-travel breadcrumbs are the exceptions — deliberately droppable**: a definitive-4xx batch is
  dropped (coverage degrades to an honest `no_data` gap / the fuel estimate stands in), never
  parked.
- **Location tracking is time-bounded, not just event-bounded.** On-duty sampling stops at
  `config.attendance.maxDutyHours` (14h) even if the tech never clocked out, and job-travel
  breadcrumb sampling stops at `MAX_TRAVEL_MS` (4h) even if the arrival punch never came. All
  privacy layers route through `dutyStatus` (`pingTracker.ts`) / the travel state
  (`travelTracker.ts`); don't add a path that samples without them. Ping `captured_at` is likewise
  trust-windowed server-side (rejected outside ~48h back / 2min forward) so it can't be back-dated
  to rewrite an attendance day.

---

## Where things live

Each capability is a same-named folder per runtime:
`src/features/<x>/` (web) ⇄ `technician-app/src/features/<x>/` (mobile) ⇄
`backend/app/features/<x>/` (backend). Backend slice = `router → service → repository`, with
`schemas.py`/`models.py`/`deps.py`/`tests/`. For the full lookup table ("feature X lives
where?") and an end-to-end trace, see **`docs/CODE-MAP.md`** (Part 3 + Part 6).

**Backend slices** (migrations 0020–0036 grew the operational store into a 38-table data
asset — spec: `docs/fixflow-erd-specification.md`): `identity`, `jobs`, `media`, `attendance`,
`notifications`, `ops`, `health`, plus the ERD additions **`tenancy`** (`shop`/`area`),
**`customers`** (`customer`/`customer_phone`/`consent`/`appliance_unit`; consent writes via
`POST /api/customers/{id}/consent` and the intake consent chip), **`catalog`**
(`appliance_category/brand/model` + aliases, `fault_code`/`action_code`, `part`/`part_alias`;
read-only picker endpoints under `/api/catalog/` since 0036),
**`telemetry`** (`app_event`/`ops_metric_rollup`, the `POST /api/events` ingest), and
**`customer_messaging`** (`customer_message` + the WhatsApp surface: wa.me preview/send-log
endpoints under `/api/messaging/`, a settings-gated Meta Cloud API sender, and the signed
`/api/webhooks/whatsapp` callback — see `backend/app/features/customer_messaging/service.py`).
`job_event` doubles as a transactional outbox (`seq` + `dispatch_cursor`). New rows carry
enforced FKs; free-text intake stays in `*_raw` columns beside the resolved FK (C7 raw+resolved).

**Scheduler jobs** (`main.py` `_lifespan`, single-replica): weekly payroll export, nightly DB
backup, daily outcome auto-link scan + media-orphan sweep, a 300s ops-metric rollup, and the
outbox dispatcher (interval, gated by `settings.enable_dispatcher`, **default OFF**) whose
whatsapp consumer sends via the Cloud API when `FIXFLOW_WHATSAPP_*` is configured and stays
log-only otherwise. Each is idempotent so a duplicate run is harmless.

---

## Commands

```bash
# Web (repo root)         Node >= 22
npm run lint && npm run format:check && npm test && npm run build

# Backend (backend/)      Python 3.12
ruff check . && ruff format --check . && mypy app && lint-imports
alembic upgrade head && alembic check
pytest                    # set FIXFLOW_TEST_DATABASE_URL to also run @integration tests

# Mobile (technician-app/)
npm run typecheck && npm test && npx expo export --platform android
```

---

## Doc map (read on demand; this file is the index)

| Doc                                | Use it for                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `docs/CODE-MAP.md`                 | The on-ramp: how to read/navigate/trace the repo (start here if unfamiliar)      |
| `ARCHITECTURE.md`                  | Layer map, dependency rules, how to add a feature                                |
| `docs/SOLUTION-ARCHITECT-GUIDE.md` | The _why_ behind decisions; where a new capability belongs                       |
| `docs/PLAYBOOK.md`                 | Operational checklist before building a slice (offline, push, migrations, media) |
| `docs/HANDOFF.md`                  | Live URLs, demo credentials, what's real vs demo                                 |
| `docs/PRODUCT-READINESS-REVIEW.md` | Forward-looking "what to harden next"                                            |

---

## Keeping this file honest

When you change the stack — a dependency, a cloud service, the auth mechanism, the offline
engine, the deploy path — **update this file in the same PR**, and fix any prose doc that now
contradicts it. The facts most prone to rot (audit these if anything feels off): the storage
backend (was Supabase Storage → now R2), the auth mechanism (never GoTrue — custom JWT), the
offline engine (hand-rolled, not a library), the Alembic head number, and the Expo SDK version.
If you catch a doc asserting one of these wrongly, correct it — that drift is exactly why this
file exists.
