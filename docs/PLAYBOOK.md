# FixFlow — Build Playbook & Handoff Notes

Operational knowledge for shipping a feature ("slice") fast. Read this +
[`ARCHITECTURE.md`](../ARCHITECTURE.md) + [`CONTRIBUTING.md`](../CONTRIBUTING.md)
before starting a slice. This file is the distilled cost of building the
**media** slice — don't re-pay these lessons.

---

## Architecture (locked — do not re-litigate per slice)

Modular monolith, vertical slices, three runtimes:

- **Web manager** — React + Vite (repo root `src/`). Still on **mock data** (not yet API-backed).
- **Technician app** — Expo (Android), shipped via EAS builds.
- **Backend** — **FastAPI** (Python 3.12) + **Supabase Postgres** (relational data) + **Cloudflare R2** (files/media).

We considered a Supabase-native (PostgREST + Edge Functions) backend and
**rejected it**: $0 is temporary and the product has growing business logic, so
a real FastAPI tier wins. **Auth is not built yet** — endpoints are currently
open; pass ids explicitly (e.g. `job_id`, `tech_id`) for now.

---

## Where things live (non-secret)

- **Repo:** `github.com/Tempest-Zero/EMS_workshop1`. `main` is the baseline and is branch-protected (PR + CI required; repo-admin can bypass to merge).
- **Backend (live):** `https://efficient-tenderness-production-2d09.up.railway.app` → `/docs` (Swagger), `/api/health`.
  - Hosted on **Railway** (project `fixflow`, service `efficient-tenderness`, region `sfo`). Deployed via `railway up` from `backend/`. **Not** GitHub-connected → after a backend change you must `railway up` again to redeploy.
- **DB:** Supabase, project ref `erkfetcbrwioatprhogj`, region `ap-south-1`.
- **Storage:** Cloudflare R2, bucket `job-media`, account `40085c3ac9abbc5d3a13b3cc3ecd34bc`.
- **Secrets** live in `backend/.env` (local) and Railway → service → **Variables** (deployed). Never in git or chat.

---

## How to build a backend slice (recipe — copy the `media` slice)

1. `backend/app/features/<slice>/`: `models.py` (ORM) · `schemas.py` (Pydantic DTOs) · `repository.py` (DB access) · `service.py` (business logic = the public surface) · `router.py` (HTTP) · `tests/`.
2. Register models in `app/registry.py`; mount the router in `app/main.py`.
3. New tables → Alembic: `alembic revision --autogenerate -m "..."` then `alembic upgrade head`.
4. Gates before commit (from `backend/`, venv active): `ruff format . && ruff check . && mypy app && pytest`.
5. Wire the client(s): web `src/features/<slice>/` and/or Expo `technician-app/src/features/<slice>/` call the API, replacing mock data.
6. PR → CI (frontend + backend + mobile) green → merge. If the backend changed, `railway up` to redeploy and run any new migration against the DB.

**Boundaries:** a feature imports `shared/`/`core/` only; reach other slices through their `service.py` (never their repo/model). Keep any external integration behind a small `Protocol` — that's what made the Supabase→R2 storage swap a one-file change with tests untouched (`core/storage.py`).

---

## Gotchas we paid for (avoid these)

1. **Supabase direct connection is IPv6-only** → fails from Railway/most hosts. Use the **Session pooler** (IPv4): `postgresql+asyncpg://postgres.erkfetcbrwioatprhogj:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres`. The direct `db.<ref>.supabase.co` string only works from a dev laptop.
2. **SQLAlchemy async needs `+asyncpg`** in the URL — a bare `postgresql://` selects psycopg2 (not installed) → crash on boot. `config.py` now auto-coerces it, so a pasted pooler string just works.
3. **R2, not Supabase Storage, for files** ($0 egress). Use pre-signed **PUT** (R2's pre-signed POST is unreliable). R2 **account ID = the subdomain** of the S3 endpoint. Private bucket + signed GET for reads. Enforce upload size at the `/complete` step + client-side compression.
4. **Railway's CLI/GraphQL API (`backboard`) times out intermittently** on some networks. When `railway init` / `railway variables` / `railway domain` flake, do them in the **dashboard** instead (Variables → Raw Editor; Settings → Networking → Generate Domain). The `railway up` build/deploy path is reliable.
5. **Railway team-scoped API tokens fail `whoami`/`list`** — don't validate a token that way and conclude it's bad. Browser `railway login` works fine.
6. **Expo + Google login = no password** → the terminal email/password login can't work. Use **`EXPO_TOKEN`** (from `expo.dev/settings/access-tokens`): `$env:EXPO_TOKEN="..."` then `eas build`.
7. **Native modules** (`react-native-compressor`, `expo-video`) require an **EAS build** — Expo Go can't run them. The `preview` profile = standalone APK pointing at the deployed backend. The API URL lives in `eas.json` and is **build-time only** — `eas update` (OTA) does **not** carry it, so rebuild when the URL changes.
8. **Don't churn the architecture.** It cost us the most. It's decided above — lock per-slice scope before building.

---

## What the agent can't do (plan handoffs around this)

The agent **cannot** create accounts, complete browser OAuth, or pop GUI auth from its sandbox. So **account signup + the first credential/token are always the human's step** — do them early and paste the resulting tokens/URLs. The agent does everything else (code, config, deploy via CLI/token, live verification).

The safety layer also blocks: (a) probing the production DB with **guessed** hostnames — get the exact pooler string from the dashboard; and (b) the agent **auto-merging its own changes** to protected `main` — the human merges or explicitly authorizes.

---

## Verification that worked (keep doing it)

Every change → run that stack's gates before committing. Verify a deploy with a
live smoke: `GET /api/health` (app is up) **and** a DB-touching endpoint (e.g.
`GET /api/jobs/<id>/media` → `200 {...}`) to confirm the DB connection. Reading
the signals: **500 on a data endpoint** = DB/logic issue; **502 on everything
(incl. /health)** = boot crash → read Railway deploy logs.

---

## Deferred (NOT built yet — future slices)

Auth (Supabase GoTrue + JWT verified in FastAPI), manager-side media viewing
(web → `GET media` API), server-side SOP gate (needs a jobs slice), R2 retention
(lifecycle rule + `pg_cron`), and migrating the web app off mock data onto the API.

---

## Next slice: Attendance

- **Mock today (web):** `src/features/attendance/` — `data/attendance.js`, `Attendance.jsx` (manager monthly grid), `ClockIn.jsx` (tech), `MonthDots.jsx`, `lib/cells.js`. Domain: clock in/out, monthly grid, statuses `present | absent | field | half | leave | holiday`.
- **DB-only — no R2** (no files), so it's simpler than media. Build `backend/app/features/attendance/` per the recipe (records + queries), add the migration, then wire the web `Attendance`/`ClockIn` screens (and the Expo `ClockIn` if in scope) to the API.
- **Decide upfront:** real auth vs. pass `tech_id` explicitly for now. Recommended: pass `tech_id` (like media passes `job_id`) and defer auth to its own slice.
