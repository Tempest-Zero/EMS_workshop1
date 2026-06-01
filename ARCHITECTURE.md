# Architecture

FixFlow is a **modular monolith** built as a single React SPA. The codebase is
organized into **vertical slices**: code is grouped by _business capability_
(jobs, technicians, attendance, …) rather than by technical layer
(components/, pages/, data/). A team can own and ship a slice end-to-end with
minimal cross-talk.

> Today the app runs entirely on in-browser mock data — there is no backend yet.
> The structure below is designed so a real backend can be added later as its own
> set of modules without reshuffling the frontend.

---

## The three layers

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

## Tooling

- **Vite** — dev server + production build.
- **ESLint** (flat config) — `npm run lint`.
- **Prettier** — formatting; `npm run format` / `npm run format:check`.
- **Vitest + Testing Library** — unit/component tests; `npm test`.
- **GitHub Actions** — `.github/workflows/ci.yml` runs lint, format check, tests
  and build on every PR and push to `main`.
