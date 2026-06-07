# FixFlow — the Jobs vertical (plan)

Status: **in progress.** J0 (this slice) is the auth + roster foundation. The
rest of the roadmap is below so each PR can be reviewed against the whole.

## Why this exists

The two slices shipped so far — **attendance** and **media** — are the *evidence*
layer (proof of presence, proof of before/after work). They're real (Postgres,
offline sync, tested) but they orbit a planet that doesn't exist yet: the
**Job**. The web prototype (`src/`, driven by mock data) designs the whole
product — intake → assign → diagnose → estimate → approve → repair (with photos)
→ mark ready/SMS → payment → close — for both a manager (desktop) and a
technician (mobile). The mobile app you can install today has only Clock + Media
tabs. The Jobs vertical builds the spine that turns three disconnected demos into
one app.

The spec is the prototype: `src/app/providers/AppContext.jsx` (every operation)
and `src/features/jobs/data/jobs.js` (the Job shape).

## Decisions locked for the whole vertical

1. **Auth is real and minimal — Name + PIN → JWT.** The server derives identity
   from a verified token (`sub` = tech id), never from a client-supplied param.
   This replaces the "trust the passed `tech_id`" model. **Flat permissions:**
   any logged-in user can do everything (a `role` is stored for display and
   future gating, but v1 enforces none).
2. **Money is integer paisa**, never floats — applies when the estimate/payment
   PR lands.
3. **Migrations run on deploy** (`start.sh` → `alembic upgrade head` → uvicorn).
4. **IDs:** UUID primary keys (like attendance/media), plus a human `token`
   integer on jobs for the `#1052` reference. Technicians keep their string slug
   PK (`t1`…) so existing attendance/media data stays valid.
5. **Real `technician` table** (roster, identity, assignment). **Customer stays
   embedded on the job** for v1; a normalized repeat-customer entity is deferred.

## Roadmap

| PR | Scope | Flips to real |
| --- | --- | --- |
| **J0 — Foundation** ✅ | `technician` table + seed; Name/PIN → JWT (`/auth/login`, `/auth/me`); `get_current_principal` dependency; migrations-on-deploy | login capability + roster API |
| **J0.5a — Web login + manager guard** ✅ | manager web login screen + token storage + `Authorization` header; enforce auth on the **manager** attendance endpoints (board/grid/tech-days/shifts/geofences/adjustments). Mobile/tech endpoints stay open so the installed APK keeps working | manager web behind login; manager API token-guarded |
| **J0.5b — Mobile login + tech guard** | mobile login screen, token storage, punch identity from the token; enforce auth on the tech-facing punch/today/media endpoints (needs an APK rebuild) | login on the phone; the rest of the API guarded |
| **J1 — Jobs core backend** ✅ | `job` table (customer fields + appliance + problem + status + assigned tech + token) + seed of the 17 prototype jobs; `GET /jobs` (filter by status/tech/search), `GET /jobs/{id}`, `POST /jobs` — all auth-required | live jobs API |
| **J1b — Jobs read UI** ✅ | AppContext loads jobs from the API (mapped to the view shape) once logged in; `New Job` POSTs for real. JobsBoard/JobDetail/MyJobs/Dashboard now render live data | manager JobsBoard + JobDetail + Dashboard, tech MyJobs |
| **J2a — Lifecycle backend** ✅ | append-only `job_event` timeline; `POST /jobs/{id}/notes`, `/followups`, `/transition` (ready, close, abandon, reschedule, haul); `GET /jobs/{id}` returns the timeline | live timeline + status API |
| **J2b — Lifecycle UI** *(this PR)* | wire JobDetail's note/follow-up/status actions to the API so they persist (removes J1b's in-session-only gap); render the real timeline | JobDetail action bar persists |
| **J3 — Media × Jobs** | capture launches *from a job*; JobDetail Photos shows real thumbnails | wires the existing media slice to the spine |
| **J4 — Money** | estimate (parts/labor, **paisa**) + approve/decline + payment | JobDetail Estimate + Payment cards |
| **J5 — Mobile parity** | My Jobs + Job Detail (+ static Diagnose + Profile) in the actual APK | the app matches `TechLayout` |
| **J6 — Schedule** | assignments / My Week | Schedule + MyWeek |

**Deferred (the prototype marks these as integrations):** Payroll, SMS provider.
Troubleshooting stays static reference data.

## J0 — what's in this PR

- `app/features/identity/`: `Technician` model, `IdentityRepository`,
  `IdentityService` (PIN auth + roster), router (`GET /api/technicians`,
  `POST /api/auth/login`, `GET /api/auth/me`), and `deps.get_current_principal`
  — the cross-slice "who is the caller" dependency other routers will use.
- `security.py`: PBKDF2 PIN hashing (stdlib) + HS256 JWT (PyJWT).
- Migration `0004`: creates `technician` and seeds the five mock techs.
- `start.sh` + Dockerfile: migrate-then-serve on every deploy.
- Tests: security + service units, real-DB login/me/roster integration.

**Non-breaking on purpose:** J0 does *not* yet enforce auth on attendance/media,
so the already-installed APK keeps working. Enforcement + the client login
screens land together in **J0.5**, so the app never sits in a broken state.

### Seed accounts (first login)

All five seeded technicians share the default PIN **`1234`**. `t1` (Imran Ahmed)
is seeded as `manager`; the rest as `tech`. Change PINs once an account-management
flow exists (deferred). Set a real `FIXFLOW_JWT_SECRET` in production.

## Where you can help

- A real per-tech PIN list (or confirm the shared `1234` default is fine for now).
- Confirm single-shop (`shop_id = "default"`) still holds for the Jobs tables.
