# FixFlow — Solution Architect's Guide & Full Project Context

> **Why this document exists.** You own this product but you don't yet hold it
> in your head at a *solution-architect* level — the level where you can reason
> about *where* a capability should live, *why* a decision was made, and *what*
> the next move is, without re-reading every file. That gap is your current
> bottleneck. This document is the cure. It is long on purpose. Read it once
> end-to-end to build the mental model, then keep it open as a reference.
>
> It is deliberately different from the other docs:
> - [`README.md`](../README.md) tells a newcomer how to run it.
> - [`ARCHITECTURE.md`](../ARCHITECTURE.md) tells a contributor the layer rules.
> - [`docs/PLAYBOOK.md`](./PLAYBOOK.md) tells a builder the operational gotchas.
> - [`docs/client-requirements-gap-analysis.md`](./client-requirements-gap-analysis.md) maps the
>   client's stated requirements to what's actually built.
> - **This file teaches you to *think about the whole system* and make the next
>   architectural calls yourself.**

---

## Table of contents

1. [The business — understand this before any code](#part-1--the-business)
2. [The mental model — five ideas that explain everything](#part-2--the-mental-model)
3. [The architecture in detail](#part-3--the-architecture-in-detail)
4. [The data model](#part-4--the-data-model)
5. [Current state — real vs. prototype, honestly mapped](#part-5--current-state)
6. [The D1/D2 decision — what went wrong and the lesson in it](#part-6--the-d1d2-decision)
7. [How to think like the architect here — decision frameworks](#part-7--decision-frameworks)
8. [The roadmap & the open architectural decisions](#part-8--roadmap--open-decisions)
9. [Quick reference — glossary, file map, PR ledger](#part-9--quick-reference)

---

## Part 1 — The Business

You cannot architect what you don't understand at the domain level. So start here, not with the tech.

### The company

A small **home-appliance repair workshop in Karachi, Pakistan**. They fix ACs,
washing machines, refrigerators, microwaves. Two ways work comes in and gets done:

- **Carry-in** — the customer brings the appliance to the shop. The technician
  repairs it on a bench. The customer comes back, pays at the counter, takes it home.
- **Home-visit** — the technician *travels to the customer's home*, diagnoses and
  repairs on-site, negotiates a price face-to-face, and **collects cash there**.

That second flow is the one that drives most of the hard requirements. Hold it
in your mind: **a technician, standing in someone's kitchen, often with bad
signal, negotiating a price and taking cash.** Almost every "why is this hard"
answer traces back to that picture.

### The three actors

| Actor | Where they are | Primary device | What they do |
|---|---|---|---|
| **Manager / owner** | At the shop, at a desk | Desktop browser | Oversee the whole shop: intake jobs, assign work, watch the board, see attendance, see revenue, run accounting |
| **Technician** | At the bench **or in the field** | Android phone | Clock in, claim/receive jobs, do the repair, capture before/after media, fill the completion form, negotiate & collect cash, mark done |
| **Customer** | Their home or the shop | (none — they're not a user) | Sends complaints via **WhatsApp**, receives the bill via **WhatsApp**, pays cash |

> **Architectural seed #1:** the manager is a *desktop/oversight* actor; the
> technician is a *mobile/field* actor. This split is the single most important
> thing to internalize — it's the lens you'll use in Part 6 and Part 7.

### The money flow (this is where the product earns its keep)

1. A complaint arrives (ideally via **WhatsApp**). A job is opened.
2. The job is assigned to a technician (manager assigns **or** technician claims it).
3. The technician does the work and records what was used (the **completion form**).
4. The system **auto-generates an "original" bill** from that form (parts + labour + travel/fuel).
5. On-site, the customer **negotiates**. The technician records the **negotiated**
   amount. **Both the original and the negotiated amount must be stored and
   reportable** — this is a hard accounting requirement (it's how the owner sees
   how much discount technicians are giving away).
6. The bill is sent to the customer via **WhatsApp**, with **no company branding**
   on the message (a specific client constraint — confirm *why* with them).
7. The technician collects **cash**, logged **against the job**.
8. Each payment becomes a **revenue/accounting record**. Corrections are allowed,
   but as an **audit trail** (you void and re-enter; you never silently edit).
9. Attendance feeds **payroll**: every **Sunday**, hours are exported to a payroll/ERP system.

### The four client modules (in plain language)

The client described the product as four modules. The full requirement-by-requirement
gap map is in [`docs/client-requirements-gap-analysis.md`](./client-requirements-gap-analysis.md);
here is the human summary.

- **Module 1 — Attendance.** Honest clock-in/out, geo-tagged at the workshop,
  **must work offline**, auto-export to payroll/ERP every Sunday. (Stretch goals
  the client floated: barcode check-in, face recognition.)
- **Module 2 — Complaint & Job management.** Complaints arrive via WhatsApp →
  become jobs. A live work list. **Dual assignment** — a manager can assign a job
  *or* a technician can free-pick ("claim") one. Push notification to the tech.
- **Module 3 — SOP / Field operations.** Enter customer details before work.
  **Before/after photos & video.** GPS punch on workshop departure + customer
  arrival, route recorded → fuel. A **completion form**: materials used, time
  spent, travel/fuel, remarks (**text or audio**). **A closing video is required
  to close a job.**
- **Module 4 — Billing & accounting.** Bill auto-generated on completion.
  **Original vs negotiated** (both stored). Delivered via WhatsApp, no branding.
  Cash logged per job. Every payment → a revenue record. Corrections are audited.

### The cross-cutting constraints (the "Key Flags")

These apply *across* all modules and are the real architectural drivers:

- **Offline is non-negotiable.** Attendance, job logging, and forms must work
  with no signal. (Today only attendance + media are offline.)
- **Dual assignment** must support *both* paths simultaneously.
- **Original-vs-negotiated** billing is a hard, reportable requirement.
- **Audio remarks** on completion.
- **Sunday payroll cycle.**
- **Closing-video gate** on closure.

> **Architectural seed #2:** "offline non-negotiable" + "the technician is the
> field actor" together *force* a conclusion — **the field workflow (jobs,
> completion, on-site billing, cash) has to live on the phone with a durable
> local queue.** This is exactly the lens that tells you D1/D2 went to the wrong
> place. We'll formalize it in Part 6.

---

## Part 2 — The Mental Model

Five ideas. If you hold these five, the whole codebase becomes legible.

### Idea 1 — Three runtimes, one product (a "modular monolith")

A "monolith" usually means one deployable. Here it means one *coherent product*
with one backend, expressed across **three runtimes** (places code runs):

```
        ┌──────────────────────────────────────────────────────────┐
        │                     ONE PRODUCT: FixFlow                    │
        └──────────────────────────────────────────────────────────┘
                 │                  │                      │
        ┌────────▼───────┐  ┌───────▼────────┐   ┌─────────▼────────┐
        │  WEB MANAGER   │  │  MOBILE TECH   │   │     BACKEND      │
        │  React + Vite  │  │  Expo / RN     │   │  FastAPI (Python)│
        │  (desktop)     │  │  (Android)     │   │  the control plane│
        │  src/          │  │  technician-app/│   │  backend/        │
        └────────────────┘  └────────────────┘   └──────────────────┘
                 │                  │                      │
                 └──────────────────┴──────────┬───────────┘
                                                │ talk to
                              ┌─────────────────▼──────────────────┐
                              │  Supabase Postgres  +  Cloudflare R2 │
                              │  (rows / truth)        (file bytes)  │
                              └──────────────────────────────────────┘
```

The web and mobile apps are **clients**. The backend is the **source of truth**.
A feature isn't "real" until the backend persists it — a client-only feature is
a *prototype of* the feature, not the feature.

### Idea 2 — Vertical slices (organize by capability, not by layer)

Most codebases group files by *technical layer* ("all the controllers here, all
the models there"). FixFlow groups by *business capability* — a **slice**. The
slice `jobs` has a folder on the backend, the web, and the mobile app. One person
can own `jobs` end-to-end (UI → API → database) without stepping on the person
who owns `attendance`.

```
   jobs slice:    src/features/jobs/  ⇄  backend/app/features/jobs/  ⇄  technician-app/src/features/jobs/
   media slice:   src/features/media/ ⇄  backend/app/features/media/ ⇄  technician-app/src/features/media/
   attendance:    src/features/attendance/ ⇄ backend/.../attendance/ ⇄ technician-app/.../attendance/
```

Why this matters for *you*: when you plan a feature, you plan it **as a slice
across the runtimes that need it** — "which side captures it, which side views
it, what does the backend store." That single habit is half of solution
architecture on this project.

### Idea 3 — Control plane vs. data plane

A subtle but powerful split:

- **Control plane** = the small, important messages: "create this job," "this
  punch happened," "give me a URL to upload to." These go through **FastAPI**.
- **Data plane** = the big dumb bytes: the 30 MB repair video. These **never**
  touch FastAPI. The phone uploads them **directly to Cloudflare R2** using a
  short-lived signed URL that FastAPI minted.

```
   phone ──(1) "I want to upload a video for job 1051"──▶ FastAPI   (control)
   phone ◀──(2) "here's a signed URL, valid 10 min"──────  FastAPI
   phone ══(3) PUT 25 MB of video bytes ════════════════▶ R2        (data — bypasses FastAPI)
   phone ──(4) "done, it's 25 MB"──────────────────────▶ FastAPI   (control)
```

This is why the server stays cheap and fast even with video: it only ever moves
*control messages*, never the heavy payload. Internalize this — you'll reuse the
exact same pattern for the **closing video** and **audio remarks**.

### Idea 4 — Evidence vs. spine

The slices were built in a specific order for a reason:

- **Attendance** and **media** are the **evidence layer** — proof of presence,
  proof of before/after work. They were built *first* because they're
  self-contained and demonstrate trust.
- **Jobs** is the **spine** — the thing everything else hangs off (a bill belongs
  to a job; media belongs to a job; assignment is about a job). It was built
  *second*, deliberately, because the evidence slices "orbit a planet that didn't
  exist yet" (the team's own words).

When you plan new work, ask: *is this evidence (hangs off the spine) or is it
spine (everything hangs off it)?* Spine changes are higher-stakes.

### Idea 5 — Evidence, not proof (the trust model)

The attendance design has a phrase worth stealing for the whole product:
**"evidence, not proof."** The system doesn't try to make cheating *impossible*
(that's a losing battle on a personal phone). It makes cheating *visible*:

- **WHO** — a selfie at clock-in (not face-*recognition*, just a photo on record).
- **WHERE** — GPS is captured and **flagged** if outside the geofence, plus
  Android mock-location detection and workshop-WiFi corroboration — but it is
  **never used to block** a punch.
- **WHEN** — the **server's** timestamp is authoritative; the device clock is
  recorded too, and the drift between them is flagged.
- **NOT TAMPERED** — the punch log is **append-only**; a manager correction is a
  *new* event linked to the old one, never an edit.

This "capture + flag + append-only audit, enforce in the service layer" pattern
repeats in jobs (the `job_event` timeline) and is the template for the revenue
ledger. It's a house style. Learn it once, recognize it everywhere.

---

## Part 3 — The Architecture in Detail

### 3.1 Topology — what runs where

```
   ┌─────────────────────┐         ┌──────────────────────────┐
   │  Manager's browser  │         │  Technician's Android    │
   │  React SPA (Vite)   │         │  Expo dev/EAS build      │
   │  served as static   │         │  installed APK           │
   └──────────┬──────────┘         └────────────┬─────────────┘
              │  HTTPS + JWT Bearer              │  HTTPS + JWT Bearer
              │                                  │
              └───────────────┬──────────────────┘
                              ▼
            ┌─────────────────────────────────────┐
            │   FastAPI backend (Railway, sfo)     │
            │   efficient-tenderness-production…   │
            │   /api/health  /api/auth  /api/jobs… │
            │   start.sh: alembic upgrade → uvicorn│
            └───────┬───────────────────┬───────────┘
                    │ asyncpg (pooler)   │ boto3 (S3 API)
                    ▼                    ▼
        ┌───────────────────────┐  ┌──────────────────────────┐
        │ Supabase Postgres     │  │ Cloudflare R2 (job-media) │
        │ ap-south-1 (Mumbai)   │  │ private bucket, $0 egress │
        │ rows = source of truth│  │ bytes = photos/videos     │
        └───────────────────────┘  └──────────────────────────┘
```

Key facts about the topology (the *why* is in [`PLAYBOOK.md`](./PLAYBOOK.md)):

- **Railway is NOT connected to GitHub.** Merging a PR does **not** deploy the
  backend. You must run `railway up` from `backend/` to redeploy. This is the
  #1 "why isn't my change live" trap.
- **Migrations run on deploy.** [`backend/start.sh`](../backend/start.sh) runs
  `alembic upgrade head` *before* uvicorn, so a deploy can never serve against a
  stale schema. If the migration fails, the container exits (fail-safe) rather
  than booting broken.
- **The build-time API URL.** The mobile app's backend URL is baked in at EAS
  build time ([`technician-app/eas.json`](../technician-app/eas.json)). An
  over-the-air `eas update` does **not** carry it — change the URL → full rebuild.

### 3.2 The backend — slice-per-folder

Every backend slice lives in `backend/app/features/<slice>/` and has the same
five-file shape. Picture it as concentric rings, outer depends on inner:

```
   router.py     ← HTTP. Thin. Wires deps, calls service, maps errors, commits.
      │
   service.py    ← Business logic. THE PUBLIC SURFACE other slices may call.
      │
   repository.py ← Data access (SQLAlchemy queries). Private to the slice.
      │
   models.py     ← ORM tables.        schemas.py ← Pydantic request/response DTOs.
```

The rules that keep it clean (from [`ARCHITECTURE.md`](../ARCHITECTURE.md)):

1. A slice may use `core/` (config, db session, storage) and `shared/`.
2. A slice may **never** reach into *another* slice's `repository.py` or
   `models.py`. Cross-slice calls go through the other slice's `service.py` only.
   (That's the *contract*; repos/models are internal organs.)
3. `main.py` only *composes* — it mounts routers, nothing else.
4. New ORM models get registered in [`app/registry.py`](../backend/app/registry.py)
   so Alembic and the test schema see them.

**Worked example — what happens on `POST /api/jobs/{id}/transition` (mark ready):**

```
   HTTP request (with JWT)
     → router.transition()                         [router.py]
        → CurrentPrincipal dependency verifies JWT → who is calling   [identity/deps.py]
        → service.transition(action="ready", actor=tech_id)           [jobs/service.py]
           → repo.get(job_id)            load the row                  [jobs/repository.py]
           → row.status = "ready"        mutate current state
           → repo.add_event(JobEvent(kind="ready", ...))  append audit
           → repo._detail(row)           reload row + its timeline
        → session.commit()              the boundary commit           [router.py]
     → JobDetail JSON (job + events) back to the client
```

Notice: the **router commits**, not the service. The service composes the work;
the router owns the transaction boundary. That's intentional — it keeps services
composable (one service can call another without each committing half-finished work).

### 3.3 Identity & trust

- **Login:** `POST /api/auth/login` with `{ name, pin }`. The server verifies the
  PIN against a **PBKDF2 hash** (stdlib `hashlib`, no native crypto dependency)
  and returns a **JWT** (HS256, signed with `FIXFLOW_JWT_SECRET`).
- **Identity on every call:** protected endpoints depend on
  [`get_current_principal`](../backend/app/features/identity/deps.py), which
  reads the `Authorization: Bearer <jwt>` header, verifies the signature, and
  returns a `Principal { tech_id, role, name }`. **The server derives *who you
  are* from the verified token's `sub`, never from a parameter the client could
  forge.** This replaced the earlier "trust the passed `tech_id`" model.
- **Flat permissions (deliberate, v1):** any logged-in user can do everything.
  `role` (`tech` | `manager`) is *stored* for display and future gating, but **no
  per-role enforcement exists yet.** A technician's token can call manager
  endpoints. Know this — it's a real gap to close before this is a hardened product.
- **Token lifetime:** 30 days, no refresh/logout-invalidation (a workshop device
  stays logged in). Logout just drops the local token. Fine for the context,
  worth revisiting for security.
- **Seed accounts:** five technicians, shared default PIN `1234`, `t1` (Imran
  Ahmed) is the `manager`. Obviously demo-grade — real per-tech PINs are deferred.

### 3.4 The media pipeline (the signed-URL pattern, in full)

This is the most reusable pattern in the codebase. Study it once.

```
   ① Expo captures a photo/video, compresses to 720p on-device (keeps it small)
   ② POST /api/jobs/{id}/media   { phase: before|after, type: photo|video, filename }
        backend: insert job_media row (status=pending), mint a signed PUT url
        ◀ returns { media_id, signed_url }
   ③ Expo: PUT the raw bytes directly to R2 at signed_url        (data plane)
   ④ POST /api/jobs/{id}/media/{media_id}/complete   { size }
        backend: HEAD the object in R2 to read its REAL size,
                 if > r2_max_upload_bytes → delete it + 413 (reject),
                 else status=uploaded, mint a signed GET (playback) url
```

Two things to appreciate:

- **The phone never holds R2 credentials.** It only ever sees short-lived signed
  URLs. If a URL leaks, it expires in minutes and grants access to one object.
- **Size can't be faked.** A pre-signed PUT can't enforce a size limit at upload
  time, so the `/complete` step reads the object's *actual* size from R2 via a
  `HEAD` ([`storage.py` `head_size`](../backend/app/core/storage.py)). A client
  that under-reports its size still gets caught and purged.

The whole thing sits behind a `StorageClient` **Protocol** (a Python interface).
That's why swapping the storage backend (the project moved from Supabase Storage
to R2) was a *one-file change with the tests untouched* — everything else depends
on the interface, not on R2 specifically. **This is the adapter pattern, and it's
your template for every external integration to come (WhatsApp, ERP, payroll).**

### 3.5 The web app (manager)

- **Stack:** React 19, Vite 6, Tailwind v4, React Router 7. Tests: Vitest +
  Testing Library.
- **Role by URL:** anything under `/tech/*` renders the technician/mobile shell
  inside a phone frame; everything else is the manager/desktop shell. There is no
  separate "tech app" here — it's the *same SPA* showing a mobile preview. (The
  real technician app is `technician-app/`.) See [`src/app/App.jsx`](../src/app/App.jsx).
- **Layers:** `app/` (composition root: router, layouts, the global store),
  `shared/` (pure kernel — UI primitives, the API client, formatting helpers;
  imports nothing internal), `features/*` (the slices).
- **State:** one big React context,
  [`src/app/providers/AppContext.jsx`](../src/app/providers/AppContext.jsx),
  exposed via `useApp()`. It holds `jobs`, mutators (`addJob`, `markReady`,
  `setNegotiatedBill`, …) and selectors (`getJob`, `jobsByStatus`). **State resets
  on refresh** — except where it reads the live API.
- **The hybrid trick — `LOCAL_ONLY_FIELDS`.** This is important to understand
  because it's exactly where the D1/D2 issue lives. The web app loads *real* jobs
  from the API, but several fields aren't backed by any API yet
  (`estimate`, `payment`, `bill`, `revenue`, `completion`, `assignedTechId`,
  `photos`, `followUps`). When a real lifecycle action refreshes a job from the
  server, those fields would be wiped — so the code *preserves* them locally
  across the refresh. In plain terms: **billing, completion, and revenue are
  client-side illusions stitched on top of real jobs.** They look real in a demo;
  they vanish on refresh and exist on no server.

### 3.6 The mobile app (technician)

- **Stack:** Expo SDK 52, React Native 0.76, TypeScript (strict), React
  Navigation (bottom tabs + native stack). Tests: Jest (`jest-expo`).
- **Tabs:** My Jobs · Clock · Media · Profile ([`technician-app/App.tsx`](../technician-app/App.tsx)).
- **Auth:** login (roster picker + PIN) → JWT, **persisted** in AsyncStorage so
  the session survives restarts and works offline (no network needed to *restore*
  a login).
- **Offline-first attendance** — the reference implementation of the pattern the
  whole product needs: a punch is captured (selfie + GPS + WiFi) → written to an
  **AsyncStorage queue** → the UI shows instant success → a **background sync**
  pushes it when there's signal, **idempotent** on a client-generated `client_id`
  (re-sending the same punch is a server-side no-op). This is the seed of the
  "offline outbox" you'll generalize later (Part 8).
- **Jobs (M2):** My Jobs (assigned to me) + Work List (unassigned) with a
  **Claim** action that calls the *real* backend — see
  [`technician-app/src/features/jobs/JobsListScreen.tsx`](../technician-app/src/features/jobs/JobsListScreen.tsx)
  and [`technician-app/src/lib/jobsApi.ts`](../technician-app/src/lib/jobsApi.ts).

### 3.7 CI/CD

- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)): three
  parallel jobs on every PR + push to `main`.
  - **frontend** — eslint, prettier check, vitest, build.
  - **mobile** — `tsc --noEmit`, jest.
  - **backend** — ruff, mypy (strict), it **spins up a real Postgres 16 service**,
    runs `alembic upgrade head`, then `alembic check` (catches model/migration
    drift), then pytest (unit + real-DB integration).
- **`main` is branch-protected** — PR + green CI required to merge.
- **Deploy is manual** — `railway up` for the backend; `eas build` for the phone.
  CI does *not* deploy. (See the Railway/EAS notes in 3.1.)

### 3.8 Cloud services & the lessons baked into them

| Service | Role | The lesson that shaped how it's used |
|---|---|---|
| **Supabase Postgres** | Relational truth | Direct connection is IPv6-only → fails from Railway. Use the **Session pooler** (IPv4). The URL must use `+asyncpg` (auto-coerced in [`config.py`](../backend/app/core/config.py)) or the app crashes on boot. |
| **Cloudflare R2** | File bytes | Chosen over Supabase Storage for **$0 egress** (video playback would be expensive otherwise). Pre-signed **PUT** (R2's POST is unreliable). Private bucket + signed GET. Enforce size at `/complete`. |
| **Railway** | Backend host | Not GitHub-connected → deploy with `railway up`. Its CLI/GraphQL API flakes on some networks → use the dashboard for variables/domains. |
| **Expo EAS** | Mobile builds | Native modules (compressor, video) need an EAS build (not Expo Go). API URL is build-time. Run `npx expo-doctor` (want 17/17) before building. |
| **GitHub Actions** | CI gate | Three parallel jobs; backend job runs real Postgres + drift check. |

---

## Part 4 — The Data Model

Six migrations, `0001`→`0006`. The tables, grouped by slice:

### Media slice — `job_media` (migration 0001)
One row per captured artefact. `job_id` (string), `phase` (before/after),
`type` (photo/video), `storage_path` (the R2 key), `status` (pending→uploaded),
`size_bytes`. Bytes live in R2; this row is just the pointer + metadata.

### Attendance slice — four tables (migrations 0002, 0003)
- **`attendance_event`** — the append-only punch log; *the source of truth*.
  Carries the evidence fields: `server_time` (authoritative) vs `device_time` +
  `drift_seconds`; `lat`/`lng`/`inside_geofence`/`distance_m`/`is_mock_location`;
  `wifi_bssid`/`wifi_match`; `selfie_path`. The `client_id` UNIQUE constraint is
  the **offline idempotency key**.
- **`attendance_shift`** — one shift per tech (start/end, working-days bitmask,
  grace minutes, timezone) → gives "late"/"absent" meaning.
- **`attendance_geofence`** — workshop circle(s) + known WiFi BSSIDs; used to
  **flag**, never block.
- **`attendance_adjustment`** — links a manager correction to the *new* event it
  created (the log is never edited).

### Identity slice — `technician` (migration 0004)
The roster + login identity. **String PK** (`t1`…`t5`) — chosen so the existing
attendance/media rows that already reference those ids stay valid. `role`
(tech/manager), `pin_hash` (PBKDF2 string, never the raw PIN).

### Jobs slice — `job` + `job_event` (migrations 0005, 0006)
- **`job`** — **UUID PK** + a human **`token`** integer (the `#1052` reference
  the UI shows). `status` (open/waiting/ready/closed), `job_type`
  (carry-in/home-visit), **embedded** customer fields (name/phone/address) and
  appliance fields (type/brand/model), `problem`, `assigned_tech_id`, plus
  scheduling/lifecycle dates. Customer is *embedded, not normalized* — a customer
  isn't referenced by other slices yet, so it doesn't need its own table.
  Seeded with the **17 prototype jobs** (tokens 1035–1051) + an unassigned 1052.
- **`job_event`** — append-only timeline (kind, text, actor, created_at). The
  `job` row holds *current* state; `job_event` is the *audit trail* behind it.
  (Same pattern as attendance.)

### Conventions you'll see everywhere
- UUID PKs with a `gen_random_uuid()` server default (except `technician`, which
  keeps its slug PK for back-compat).
- Enums stored as `String` + a `CheckConstraint` (not native PG enums — easier to
  evolve).
- Timezone-aware timestamps with `now()` defaults.
- Every table stamped with `shop_id` ("RLS-ready"; one shop = `"default"` for now).
- **Money will be integer paisa, never floats** (a *locked decision* for the J4
  money slice — not built yet).

### What is NOT in the database yet
There is **no table** for: estimates, bills (original/negotiated), payments,
revenue ledger, completion forms, audio notes, per-job GPS/route, push tokens.
Those are either deferred (J4) or only exist as **web client-side mock state**.
This is the crux of Part 5 and Part 6.

---

## Part 5 — Current State

> The honest, load-bearing section. Internalize the difference between **🟢 real**
> (persisted on the backend, survives a refresh, works on the deployed system)
> and **🟡 mock** (a client-side illusion for demos).

### What "mock" means here, precisely
A 🟡 mock feature in this project is **real React UI driven by real interactions,
but with no backend** — the data lives in browser memory (`AppContext`), is
preserved across server refreshes by the `LOCAL_ONLY_FIELDS` trick, and **is gone
when you reload the tab.** It is a faithful *picture* of the feature, built fast
to show a client the vision (the team calls this "Tier B" of the demo). It is
**not** progress toward the shipped product on the correct runtime.

### The map

| Capability | Backend | Web (manager) | Mobile (tech) | Verdict |
|---|---|---|---|---|
| Auth (Name+PIN→JWT), roster | 🟢 | 🟢 | 🟢 | **Real** end-to-end |
| Jobs: list/create/detail | 🟢 | 🟢 | 🟢 (read) | **Real** |
| Job lifecycle (note, follow-up, ready, close, abandon, reschedule, haul) + timeline | 🟢 | 🟢 | 🟢 (read) | **Real, persisted** |
| Assign / Claim | 🟢 | 🟡 **mock** | 🟢 **real** | **Split** — web still mock; backend+mobile real (see note) |
| Attendance (offline punch, selfie, GPS/WiFi flags, grid, adjustments) | 🟢 | 🟢 (view) | 🟢 (capture, offline) | **Real** — the strongest slice |
| Before/after media (capture→R2→view) | 🟢 | 🟢 (gallery) | 🟢 (capture) | **Real** |
| **Estimate** | 🔴 none | 🟡 mock | — | Prototype only |
| **Billing (original vs negotiated)** — D1 | 🔴 none | 🟡 mock | — | **Prototype only, wrong runtime** |
| **Cash / revenue ledger** — D1 | 🔴 none | 🟡 mock | — | **Prototype only, wrong runtime** |
| **Completion form (materials/time/fuel/remarks/audio)** — D2 | 🔴 none | 🟡 mock | — | **Prototype only, wrong runtime** |
| Schedule, troubleshooting | 🔴/static | 🟡 mock | 🟡 partial | Reference/demo |
| WhatsApp intake & bill delivery | 🔴 | 🔴 | 🔴 | Not built |
| ERP/payroll export + Sunday scheduler | 🔴 | 🔴 | 🔴 | Not built |
| Per-job GPS (departure/arrival) + route + fuel | 🔴 | 🔴 | 🔴 | Not built |
| Closing-video gate | 🔴 | 🔴 | 🔴 | Not built |
| Push notifications | 🔴 | 🔴 | 🔴 | Not built |
| Face recognition / barcode check-in | 🔴 | 🔴 | 🔴 | Not built (client stretch) |

> **The assign/claim note is the tell.** D3 (work list/claim) was *first* built
> as web mock — then, in M2, it was done **properly**: a real
> `POST /jobs/{id}/assign` + `/claim` on the backend, used by the **mobile** app.
> So the backend endpoints already exist. The web's mock `assignJob`/`claimJob`
> could be deleted and rewired to the real endpoints today. **This is the
> blueprint for fixing D1/D2** — and proof your instinct matches what the project
> already did once.

### The quality bar (verified, not claimed)
All three runtimes are green right now:
- Backend: ruff clean · mypy strict clean (51 files) · **99 tests pass**, 15
  integration skipped without a DB.
- Web: **49 tests pass**.
- Mobile: typecheck clean · **19 tests pass**.

The engineering discipline is genuinely high (strict typing, real-DB integration
tests in CI, append-only audit trails, adapter-isolated integrations). The issue
is **not** code quality. It's **capability placement** — which is an
*architecture* problem, which is exactly the muscle you're building.

---

## Part 6 — The D1/D2 Decision

### Your question, restated

> "An AI agent built D1 (billing: original-vs-negotiated + cash/revenue) and D2
> (completion form + voice note → auto-bill) as **mocks in the web app**. They
> should have been in the **mobile app**. Do you agree?"

### My answer: yes — with a precision that matters

**D2 (completion form): I fully agree — it belongs on mobile + backend.**
The completion form records *materials used, time on-site, travel/fuel expense, a
closing video, and audio remarks*. Every one of those is a thing a technician
produces **at the job, at the moment of completion** — half of them
(travel/fuel, closing video, audio) are *physically meaningless* for a manager
sitting at a desk. And the client said field forms **must work offline**. A
desktop web app, by its nature, is online and operated at the shop. So D2 on
web-mock is the wrong actor, the wrong location, and the wrong offline posture.
It's a *picture* of the completion form, not the completion form.

**D1 (billing/cash): I agree on the capture half, and this is the nuance that
makes you an architect.** Split the capability:

- The **on-site capture** — recording the *negotiated* amount and the *cash
  received* — happens in the customer's home, by the technician, often offline.
  → **Mobile + backend.** Web-mock is the wrong place for this half. ✔ you're right.
- The **original bill generation** is a *derivation* from the completion form.
  → It should be computed/stored by the **backend** when the completion form is
  submitted, not invented in the browser.
- The **reporting & oversight view** — the owner seeing original-vs-negotiated
  across all jobs, the revenue ledger, the accounting records, corrections.
  → This one **legitimately belongs on the web (manager)**. The owner does this
  at a desk. So the *web work isn't entirely wrong* — it's the right place for the
  *view*, but it was built as the *capture + the truth*, which it is not.

So the sharpest version of the verdict:

> **D2 should be mobile + backend. D1's *capture* (negotiated amount, cash)
> should be mobile + backend; D1's *truth* must be the backend; D1's *reporting*
> may stay on web. The mistake common to both: they were built as web-only
> client illusions with no backend, conflating "a manager's screen" with "the
> capability itself," and ignoring offline.**

### Why the mistake happened (so you can spot the pattern, not just this instance)

It was a **demo-driven** decision masquerading as a **product-driven** one. The
web app already had a design system and needed no slow EAS rebuild, so it was the
*fastest place to draw a convincing picture* for a client demo. As a *demo
artifact*, that's defensible — the gap-analysis doc even labels it "Tier B: fast
web-prototype additions to show the full vision," and says *"be explicit about
real vs prototype."* The failure was letting a **demo shortcut be mistaken for
real progress on the right runtime.** When the demo is over, the field
capabilities still have to be (re)built where they actually live: the phone +
the backend.

### The corrective path (not "delete it" — *relocate* it)

You don't throw the web work away. You re-cast it:

1. **Build the backend truth (the J4 "money" slice).** Tables for `completion`,
   `bill` (original + negotiated, **integer paisa**), and a `revenue` ledger
   (append-only, correctable — reuse the `attendance_adjustment` pattern). This
   is the missing center; everything else is a client of it.
2. **Move *capture* to mobile.** Completion form + negotiated-amount + cash entry
   become technician screens that write to the J4 backend, **through the offline
   outbox** (Part 8) so they work with no signal. This is the M3/M4 mobile work.
3. **Re-cast the web as the manager *view*.** Keep the well-built D1 UI
   components, but point them at the real API as **read/report** screens
   (original-vs-negotiated reporting, revenue oversight, corrections). Delete the
   client-side `setNegotiatedBill`/`logPayment`/`submitCompletion` mock mutators
   and the `LOCAL_ONLY_FIELDS` for those fields.
4. **Follow the proof you already have:** assign/claim went mock-web → real
   backend+mobile in M2. D1/D2 take the identical journey.

### The one principle to take from all of this

> **A capability lives where its *primary actor* performs it, persists in the
> *backend*, and may be *viewed* elsewhere. Capture-location and view-location
> are different questions. "Which screen looks good in a demo" is neither.**

---

## Part 7 — Decision Frameworks

These are the reusable thinking tools. When the next "where should this go?"
question lands, run it through these instead of guessing.

### Framework A — "Where does a capability live?" (the 5 questions)

For any new capability, answer in order:

1. **Who is the primary actor?** Manager → leans web. Technician → leans mobile.
   System/automation → backend job.
2. **Where are they physically when they do it?** At a desk → web is fine. In the
   field / at the bench → mobile.
3. **Must it work offline?** If yes → it **must** be mobile with a durable local
   queue. A web app cannot satisfy "offline non-negotiable." This question can
   *override* the first two.
4. **Who owns the source of truth?** Always the backend. The UI is a client. The
   capability is not "done" until the backend persists it.
5. **Who else needs to *view* it?** Usually the manager (web). *Capture* and
   *view* are separate builds against the same backend — don't conflate them.

Run D2 through it: technician (1) · in the field (2) · offline yes (3) · backend
truth (4) · manager views reports (5). → **Mobile capture + backend truth + web
report.** Clean answer, every time.

### Framework B — The offline test

Ask: *"If the technician does this in a basement with no signal, what happens?"*
- If the answer is "it fails" but the spec says it must work → it belongs on
  mobile, behind the **outbox** (Part 8), full stop.
- If the answer is "they'd never do this offline" (e.g. the owner running a
  revenue report) → online web is fine.

### Framework C — The integrations edge (adapter pattern)

Every external system (WhatsApp, ERP, payroll, an SMS provider, a maps/route
API) is **a risk and a moving target.** Never let its specifics leak into your
business logic. Instead:

1. Define a **narrow interface** (a Python `Protocol`) for what your domain needs
   — e.g. `BillNotifier.send(job, bill) -> Receipt`.
2. Write **one adapter** that implements it against the real provider.
3. Your services depend on the *interface*. Tests use a fake.

You already have the canonical example: `StorageClient` made the Supabase→R2 swap
a one-file change. **Do this for WhatsApp and ERP from day one** — they will
change, and the client even has open questions about which providers to use.

### Framework D — "Extend, don't rebuild"

The standing instruction on this project (from the gap analysis): the web
prototype already designs ~60% of the product. New work should **reuse the
existing design system and patterns** (shared UI primitives, the JobDetail
layout, the append-only audit pattern, the signed-URL pipeline) rather than
starting fresh. Before building anything, ask *"what existing pattern is this an
instance of?"* — usually there is one.

### Framework E — Scoping a slice (so a PR stays reviewable)

The project ships in small, vertical, individually-green PRs (the J/D/M
milestones). When you scope work:
- One slice, one coherent capability, across only the runtimes it needs.
- Backend + the client(s) that *consume* it land together — avoid "backend done,
  UI not wired" (and avoid its mirror, "UI mock, backend never built" — that's
  literally the D1/D2 bug).
- Every PR keeps all three CI jobs green.
- Update the docs in the *same* PR (doc-rot is the slice owner's responsibility).

---

## Part 8 — Roadmap & Open Decisions

### The milestone scheme (decode the branch names)
- **J0–J6** = the **Jobs vertical** (the spine + money + mobile parity).
  J0 identity → J0.5 auth guards → J1 jobs core → J2 lifecycle → J3 media-on-web
  → **J4 money (NOT built)** → J5 mobile parity → J6 schedule. Plan in
  [`docs/archive/jobs-vertical-plan.md`](./archive/jobs-vertical-plan.md).
- **D1–D3** = the **demo** web-prototype additions (billing, completion,
  worklist) — the "Tier B" mocks. *These are the ones to relocate.*
- **M1–M2** = the **mobile rebuild** (foundation, then My Jobs/claim). M3+ is the
  field SOP on the phone — *this is where D1/D2's real home is*.

### The big rocks (roughly in dependency order)

1. **The offline outbox — the single most important architectural decision.**
   Today attendance and media each have their *own* ad-hoc offline queue. The
   spec demands that *job logging, completion forms, billing, and cash* also work
   offline. Building four more bespoke queues is a mess. **Generalize one durable
   write-queue** (a single AsyncStorage-backed outbox with idempotency keys and
   background sync) that *every* mutating action flows through. Get this right and
   every field feature inherits offline for free. Get it wrong and you'll fight it
   forever. The attendance sync (`technician-app/src/features/attendance/`) is the
   prototype to generalize.
2. **J4 — the money slice (backend).** Completion + bill (original/negotiated,
   integer paisa) + revenue ledger (append-only, correctable). The missing center
   that D1/D2 pretended to be. Everything billing-related is a client of this.
3. **Mobile field SOP (M3/M4).** Completion form, negotiated amount, cash — on the
   phone, through the outbox, against J4. The closing-video gate. Audio remarks
   (extend the media slice with an `audio` type + a `closing` phase). **This is
   the largest single effort and it gates any *live* demo of Modules 3–4 on a
   real device.**
4. **WhatsApp integration (the biggest external surface).** Inbound webhook
   (complaint → job) + outbound (bill delivery, no branding). Behind an adapter
   (Framework C). Needs client input: Meta Cloud API vs Twilio, who hosts the
   webhook, is the business number verified.
5. **ERP/payroll export + Sunday scheduler.** A weekly scheduled job (Railway
   cron / APScheduler / external trigger) that exports attendance in the target
   system's format. Behind an adapter. Needs the ERP's format/API from the client.
6. **Per-job GPS + route + fuel.** A new `job_location` concept (departure +
   arrival pins) reusing the attendance GPS primitives, plus a routing/distance
   call → fuel estimate.
7. **Push notifications** (Expo push + a device-token registry) — for "job
   dispatched to technician."
8. **Manager-side reporting** of original-vs-negotiated and the revenue ledger
   (the *correct* home for the D1 view work).
9. **Stretch / heavy / needs client scoping:** face recognition (enroll/match/
   liveness — a whole subsystem), barcode check-in, multi-shop (RLS), real
   per-role permissions, PIN management.

### Open questions that need the client (don't guess these)
WhatsApp provider & webhook host · why "no branding" on the bill (regulatory?
privacy?) · closing-video max length/size (R2 cost) · face-recognition accuracy/
liveness & biometric consent · which ERP + export format · what "upload to
payroll" concretely means · real workshop geofence coords + *flag vs block* policy
· what a barcode encodes.

### Decisions already locked (don't re-litigate)
Modular monolith + vertical slices + three runtimes · FastAPI over
Supabase-native (real business logic coming) · R2 for bytes ($0 egress) ·
Name+PIN→JWT, server-derived identity, flat permissions (v1) · migrations on
deploy · UUID PKs + human token on jobs · money = integer paisa · customer
embedded on the job (no normalized customer entity yet) · single shop = `default`.

---

## Part 9 — Quick Reference

### Glossary
- **Slice** — a vertical feature (jobs, media, attendance) with a folder on each
  runtime it touches.
- **Control plane / data plane** — small messages via FastAPI / big bytes direct
  to R2.
- **Evidence, not proof** — capture + flag + audit, don't try to make cheating
  impossible.
- **Principal** — the authenticated caller (`tech_id`, `role`, `name`) derived
  from the JWT.
- **Append-only / audit trail** — never edit; corrections are new linked rows
  (`job_event`, `attendance_adjustment`).
- **Outbox** — (future) one durable offline write-queue for all mutations.
- **Signed URL** — short-lived R2 PUT/GET URL minted by the backend so the phone
  never holds credentials.
- **`LOCAL_ONLY_FIELDS`** — the web's client-side fields with no backend
  (estimate/bill/revenue/completion) — i.e. the mock layer.
- **Paisa** — 1/100 of a rupee; money is stored as integer paisa to avoid floats.
- **J/D/M** — Jobs-vertical / Demo-prototype / Mobile-rebuild milestone families.

### Where things live
```
EMS_workshop1/
  src/                         web manager app (React + Vite)
    app/providers/AppContext.jsx   the global store (and the mock layer)
    shared/lib/api.js              the web HTTP client (JWT + 401 handling)
    features/<slice>/              web slices
  technician-app/              Expo mobile app (TypeScript)
    src/features/<slice>/          mobile slices
    src/lib/                        api client, auth, jobsApi, attendanceApi
  backend/                     FastAPI
    app/main.py                    app factory (mounts routers)
    app/core/                      config, db session, storage adapter
    app/features/<slice>/          router·service·repository·schemas·models·tests
    app/registry.py                ORM model registry (add new models here)
    alembic/versions/              migrations 0001→0006
    start.sh                       migrate-then-serve (prod entrypoint)
  docs/
    PLAYBOOK.md                    operational gotchas + infra map
    ROADMAP.md                     the single ordered to-do list (current)
    client-requirements-gap-analysis.md   the 4-module requirement map
    SOLUTION-ARCHITECT-GUIDE.md    (this file)
    archive/                       superseded plans (jobs-vertical, phases 1–3, remediation)
  .github/workflows/ci.yml      3 parallel CI jobs
  docker-compose.yml            local Postgres + backend
```

### The PR ledger (how it was actually built, in order)

| PR | Milestone | What it delivered |
|---|---|---|
| #1 | — | FastAPI monolith + media slice (R2 signed-URL) + Expo capture app |
| #2 | — | Wire Railway URL; auto-coerce DB scheme to `+asyncpg` |
| #3 | — | The PLAYBOOK |
| #4 | — | Unblock the EAS build |
| #5 | — | Attendance slice end-to-end + real-DB integration tests in CI |
| #6 | — | Pre-Jobs hardening (real size check, idempotency race, drift, drift-guard) |
| #7 | **J0** | `technician` table + Name/PIN→JWT + `get_current_principal` |
| #8 | **J0.5a** | Web manager login + guard the manager API |
| #9 | **J1** | `job` table + read/create API + seed 17 jobs |
| #10 | **J1b** | Flip web job views onto the live API |
| #11 | **J2a** | `job_event` timeline + notes/transition endpoints |
| #12 | **J2b** | Persist web lifecycle actions to J2a |
| #13 | **J3** | Manager web shows real before/after media per job |
| #14 | **D1** | Original-vs-negotiated bill + cash/revenue ledger *(web mock)* |
| #15 | **D2** | Completion form + voice note → auto-bill *(web mock)* |
| #16 | **D3** | Dual-assignment work list / claim *(web mock)* |
| #17 | **M1** | Mobile foundation — navigation + login + persisted auth |
| #18 | **M2** | Real `/assign` + `/claim` backend + mobile My Jobs/Work List/Claim |

All 18 are merged into `origin/main`. D1/D2/D3 are the web mocks; M2 shows the
correct mock→real relocation that D1/D2 still await.

### The fastest way to deepen your understanding from here
1. Read [`AppContext.jsx`](../src/app/providers/AppContext.jsx) top to bottom and
   label each mutator **real** (calls `jobsApi`) vs **mock** (calls `patchJob`).
   That single exercise makes the hybrid state concrete.
2. Read one full backend slice — [`jobs`](../backend/app/features/jobs/) — across
   all five files, then trace the `transition` flow in §3.2 against the code.
3. Read the mobile attendance offline pipeline
   ([`technician-app/src/features/attendance/`](../technician-app/src/features/attendance/))
   — it's the blueprint for the outbox.
4. Re-read [`client-requirements-gap-analysis.md`](./client-requirements-gap-analysis.md)
   now that you have the architecture in your head — it will read completely
   differently.
