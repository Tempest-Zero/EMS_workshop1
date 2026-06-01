# Architecture

FixFlow is a **modular monolith** delivered through **three runtimes** that
live together in this monorepo:

- **Web manager app** — React + Vite (current root `src/`, served as a SPA).
- **Technician mobile app** — Expo (React Native), Android target.
- **Backend** — FastAPI (Python 3.12) + Supabase (Postgres + Storage).

Code is grouped by **business capability** (jobs, technicians, attendance,
media, invoices, …), **not** by technical layer. A slice is the same concept
on every runtime: the `media` slice has a folder on the backend, a folder in
the Expo app, and (where relevant) a folder in the web app. One person can
own and ship a slice **end-to-end across all three sides** with minimal
cross-talk to other slices.

---

## Repo layout (monorepo)

```
EMS_workshop1/
  src/                    # web manager app (React + Vite)            ← will move to frontend/ later
  backend/                # FastAPI + Alembic + Supabase
    app/
      main.py             # app factory; mounts every feature router
      core/               # config (pydantic-settings), async DB session
      features/<slice>/   # router · schemas · models · service · repository · tests/
      shared/             # cross-slice helpers (errors, pagination, base schemas)
    alembic/              # database migrations
    tests/                # cross-cutting integration tests
    pyproject.toml        # deps, ruff, mypy, pytest config
    Dockerfile
  technician-app/         # Expo (Android demo) — scaffolds in Phase 2
  docker-compose.yml      # local Postgres + backend dev stack
  .github/workflows/ci.yml
```

> The web app stays at the repo root for now (moving it would conflict with
> in-flight feature branches). When the active branches are merged we'll
> relocate it to `frontend/` so all three runtimes are siblings.

---

## Vertical slices span the whole stack

A real vertical slice is end-to-end — UI → API → domain → database. So the
**same slice name** appears on every runtime that needs it:

```
EMS_workshop1/
  src/features/jobs/                     ⇄    backend/app/features/jobs/
  src/features/media/  (web tile/play)   ⇄    backend/app/features/media/      ⇄    technician-app/src/features/media/
  src/features/invoices/  (manager view) ⇄    backend/app/features/invoices/
```

A slice ships when all of its sides ship together — that's how we avoid the
"backend done but UI not wired" anti-pattern.

---

## Frontend (web manager) — three layers

```
src/
  app/        Composition root. Wires everything together. May depend on shared + features.
  shared/     Shared kernel. Pure, reusable. Depends on NOTHING internal.
  features/   One folder per capability (a vertical slice). Depends on shared + app store.
```

### `src/app/` — composition root

```
app/
  main.jsx                 # entry point (referenced by index.html)
  App.jsx                  # router; the URL prefix decides the role
  providers/
    AppContext.jsx         # the single app store: state + mutators + selectors, useApp()
  layouts/
    ManagerLayout.jsx      # desktop sidebar shell
    TechLayout.jsx         # mobile bottom-tab shell
    PhoneFrame.jsx         # phone bezel that frames the technician view on desktop
  components/
    RoleSwitcher.jsx       # Manager <-> Technician toggle
    ToastHost.jsx          # global toast outlet
```

Routing is role-by-URL-prefix: anything under `/tech/*` renders inside
`TechLayout` (the technician/mobile experience); everything else renders inside
`ManagerLayout` (the manager/desktop experience). There is no auth — the
`RoleSwitcher` just navigates between the two.

### `src/shared/` — shared kernel

```
shared/
  ui/        primitives, StatusChip, Avatar, StatCard, Overlay, IntegrationBadge
  lib/       currency, date, statusConfig, job, text   (pure functions)
  config/    constants (TODAY, WORKSHOP, APPLIANCE_TYPES, STATUSES, …)
```

**Rule:** `shared/` imports only npm packages. It must never import from
`app/` or `features/`. If a "shared" thing needs feature data, it is not shared —
move it into the feature.

### `src/features/<name>/` — a vertical slice

Each feature is self-contained:

```
features/jobs/
  data/         # mock data this feature owns (jobs.js)
  components/   # components used only by this feature (JobCard, NewJobForm)
  pages/        # route screens — manager and technician views live together
  index.js      # PUBLIC API barrel — what the router/other code may import
```

Current features: `dashboard`, `jobs`, `technicians`, `attendance`,
`schedule`, `troubleshooting`, `settings`. (A feature may also have a `lib/`
for feature-local helpers — e.g. `attendance/lib/cells.js`.)

---

## Dependency rules (the contract)

This is what keeps the slices independent. CI does not enforce it yet, so it is
on us in review:

1. **`shared/` → nothing internal.** Pure and reusable.
2. **`features/*` → `shared/*`** and the app store (`useApp()` from
   `@app/providers/AppContext`). Fine.
3. **Cross-feature reuse** is allowed but disciplined: import another feature's
   **data/helpers by their specific path** (e.g.
   `@features/technicians/data/technicians`). Keep these edges
   **one-directional and acyclic**. Do **not** import another feature's
   `pages` or its `index.js` barrel from inside a feature — that risks circular
   page graphs.
4. **`app/` composes.** It may import any feature's public barrel to assemble
   routes and owns cross-cutting concerns (router, layouts, global store, toasts).
5. **The router imports feature pages only through each feature's `index.js`.**

```
app  ──▶ features (via index.js barrels)  ──▶ shared
 │                  │
 └──▶ AppContext ◀──┘   (features read/write global state via useApp())
```

---

## State management

All mutable state currently lives in one provider, `app/providers/AppContext.jsx`,
exposed through the `useApp()` hook: `jobs`, `technicians`, `attendanceToday`,
toasts, plus every mutator (`addJob`, `setEstimate`, `markReady`, `logPayment`,
`closeJob`, `clockIn`, …) and selector (`getJob`, `jobsByStatus`,
`jobsForTech`, `globalActivity`). State resets on page refresh — it is seeded
from each feature's `data/` module.

This is intentionally simple for the current size. As a slice's state grows, it
can be extracted into a feature-local provider/store and composed at the app
root. The boundary rules above keep that refactor local to the feature.

---

## Path aliases

Imports use aliases instead of brittle `../../..` paths. Defined in three
places, kept in sync:

| Alias       | Path           | Configured in                                         |
| ----------- | -------------- | ----------------------------------------------------- |
| `@app`      | `src/app`      | `vite.config.js`, `vitest.config.js`, `jsconfig.json` |
| `@shared`   | `src/shared`   | same                                                  |
| `@features` | `src/features` | same                                                  |

---

## Adding a new feature

1. Create `src/features/<name>/` with `data/`, `components/`, `pages/`, and an
   `index.js` barrel.
2. Export the feature's route screens from `index.js`.
3. Register the routes in `src/app/App.jsx` (under the manager and/or technician
   route group).
4. Reuse `shared/*`; read/write global state through `useApp()`.
5. Add tests beside the code as `*.test.js` / `*.test.jsx`.

---

## Backend (FastAPI) — slice-per-folder

Each feature module under `backend/app/features/<slice>/` is self-contained
and stays inside this rectangle:

```
features/<slice>/
  router.py        # APIRouter for this slice
  schemas.py       # Pydantic request/response models
  models.py        # SQLAlchemy ORM models
  service.py       # business logic (the PUBLIC surface for other slices)
  repository.py    # data access
  tests/           # unit + integration tests
```

### Dependency rules

1. **`shared/` is dependency-free in the business sense.** Pure helpers, base
   schemas, error classes. May depend on third-party libs only.
2. **Feature slices may depend on `core/` and `shared/`.** Never on another
   feature's `repository.py` or `models.py`.
3. **Cross-slice consumption goes through `service.py`.** That's the
   contracted surface area — repositories and models are private internals.
4. **`main.py` only composes.** Mounts routers; no business code.

### Signed-URL upload pattern (media)

The mobile app **never holds a Supabase service key**. The flow:

```
Expo (capture + compress)
   ├─ 1. POST /api/jobs/{id}/media         (phase, type, filename)
   ▼
FastAPI · media slice                       validate rules, create DB row (pending),
   │                                        mint a short-lived Supabase signed UPLOAD url
   │  2. returns { signed_url, media_id }
   ▼
Expo  ──── 3. PUT bytes DIRECTLY to Supabase Storage via signed_url
   │  4. POST /api/jobs/{id}/media/{mid}/complete
   ▼
FastAPI · media slice                       mark row uploaded; persist playback url
```

Supabase is the persistence layer **behind** the monolith — not the app's
direct backend. Bytes still flow phone↔storage (no double bandwidth); only
control messages traverse FastAPI.

---

## Mobile (Expo technician app)

See [`technician-app/README.md`](./technician-app/README.md) for the planned
layout and stack. Same vertical-slice convention:
`technician-app/src/features/<slice>/`. Native modules (`react-native-compressor`,
`expo-video`) require an **EAS development build** — Expo Go is not enough.

---

## Tooling

| Side       | Tools                                                          | Commands                                   |
| ---------- | -------------------------------------------------------------- | ------------------------------------------ |
| Web        | Vite · ESLint · Prettier · Vitest + Testing Library            | `npm run lint · format · test · build`     |
| Backend    | Ruff (lint + format) · Mypy (strict) · Pytest + pytest-asyncio | `ruff check · ruff format · mypy · pytest` |
| Mobile     | Expo · EAS Build · TypeScript (scaffolds in Phase 2)           | (TBD)                                      |
| Migrations | Alembic (SQLAlchemy 2.0 async)                                 | `alembic upgrade head` / `revision -m`     |
| Local DB   | docker-compose (Postgres 16) — `docker compose up`             |                                            |

**GitHub Actions** (`.github/workflows/ci.yml`) runs both the **frontend**
and **backend** jobs on every PR and push to `main`. The mobile job is added
when the Expo project scaffolds.
