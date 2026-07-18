# FixFlow — Workshop Technician Management System

A clickable **strawman prototype** for a small home-appliance repair workshop in **Karachi, Pakistan**
(AC, washing machine, refrigerator, microwave repairs). It manages technicians, jobs, attendance,
scheduling, and the full carry-in repair lifecycle across a **manager desktop view** and a
**technician mobile view** — all from a single app.

> ⚠️ **Live backend; the web app mixes live and demo data.** A FastAPI backend (Supabase
> Postgres + Cloudflare R2) is **live on Railway** with **PIN login + JWT enforced** (manager-only
> endpoints reject technician tokens). The **Expo technician app** is a full field app — jobs,
> clock-in/out, before/after media, profile, with an offline outbox. The **web manager console**
> requires a manager login and reads the live API for jobs and attendance; a few surfaces
> (schedule, settings integrations) are still demo data and are **labeled as such** in the UI.
> The codebase is a **modular monolith with vertical slices spanning all three runtimes** — see
> [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the rules, [`docs/SOLUTION-ARCHITECT-GUIDE.md`](./docs/SOLUTION-ARCHITECT-GUIDE.md)
> for the why, and [`docs/PLAYBOOK.md`](./docs/PLAYBOOK.md) before starting a slice.

## 📦 Repo layout (monorepo)

```
strawman/
  src/                # web manager console (React + Vite)    — Getting Started below
  backend/            # FastAPI + Alembic + Supabase + R2     — backend/README.md
  technician-app/     # Expo (Android) field app              — technician-app/README.md
  docs/               # architecture, roadmap, runbooks, playbook (archive/ = superseded)
  docker-compose.yml  # local Postgres + backend dev stack
```

---

## ✨ Features

- **Manager web console** (PIN login + JWT) — desktop, left-sidebar shell, full shop overview.
  Technicians don't use the web app; their field workflows (clock-in, my-jobs, capture,
  completion) live in the separate **Expo mobile app** (`technician-app/`).
- **Live Dashboard** — KPIs (present today, active jobs, awaiting parts, revenue this week), a
  _Needs Attention_ alert strip, and a recent-activity feed.
- **Jobs module (the core)** — a status board (Open · Waiting · Ready · History), a New Job intake
  form, and a deep job-detail screen with diagnosis notes, an itemised estimate, payment tracking,
  and a full timeline.
- **End-to-end repair flow** — New Job → Add Note → Set Estimate → Approve → Mark Ready (SMS) →
  Log Payment → Close.
- **Technicians** — roster, per-technician attendance, performance, and a payroll summary.
- **Attendance** — today's clock-in/out table plus a colour-coded monthly grid; technicians clock in
  from their phone.
- **Schedule** — a weekly grid (technicians × Mon–Sat) with home-visit indicators.
- **Troubleshooting** — a searchable fault-code reference (13 codes) and common-fix guides, with an
  _Add to Job_ shortcut that drops a part straight onto a job's estimate.

---

## 🛠 Tech Stack

- **React 19** + **Vite 6**
- **Tailwind CSS** (v4, via the Vite plugin)
- **React Router** (the URL prefix drives the role — anything under `/tech` is the technician view)
- **lucide-react** icons · **Plus Jakarta Sans** typeface
- **Vitest** + **Testing Library** (tests) · **ESLint** + **Prettier** (quality)
- Path aliases: `@app` / `@shared` / `@features`
- App state lives in a single **React Context** (`src/app/providers/AppContext.jsx`)

---

## 🚀 Getting Started

```bash
# install dependencies
npm install

# start the dev server
npm run dev
```

Then open the URL Vite prints (default **http://localhost:5173**). The console requires a
manager login — demo credentials are in [`docs/HANDOFF.md`](./docs/HANDOFF.md). Routes:
`/` dashboard · `/jobs` · `/technicians` · `/attendance` · `/schedule` · `/settings`.

```bash
# quality gates (the same checks CI runs)
npm run lint          # eslint
npm run format        # prettier --write .
npm test              # vitest

# production build
npm run build
npm run preview
```

### Getting Started — Backend (FastAPI)

```bash
cd backend
python -m venv .venv && source .venv/Scripts/activate   # Windows Git Bash; *nix: .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env                                     # fill DB URL + Cloudflare R2 keys
uvicorn app.main:app --reload --port 8000               # → http://localhost:8000/api/health
```

Docker Compose, migrations, and quality gates: [`backend/README.md`](./backend/README.md).

### Getting Started — Mobile (Expo technician app)

```bash
cd technician-app
npm install
cp .env.example .env                                     # EXPO_PUBLIC_API_URL → your backend
npm start                                                # Metro; open the dev build
```

The `preview` build already points at the live backend — see
[`technician-app/README.md`](./technician-app/README.md) for the dev-vs-demo build paths.

---

## 📁 Project Structure

Organized as **vertical slices** — by capability, not by technical layer:

```
src/
  app/            # composition root: router, layouts, global store (AppContext), toasts
  shared/         # shared kernel — depends on nothing internal
    ui/           #   primitives, StatusChip, Avatar, StatCard, Overlay, IntegrationBadge
    lib/          #   currency, date, statusConfig, job, text
    config/       #   constants (TODAY, WORKSHOP, …)
  features/       # one folder per capability — a vertical slice
    dashboard/  jobs/  technicians/  attendance/  schedule/  troubleshooting/  settings/
      data/         #   mock data the feature owns
      components/   #   feature-only components
      pages/        #   route screens (manager + technician views)
      index.js      #   public API barrel (what the router imports)
docs/             # architecture, roadmap, runbooks, playbook · archive/ = superseded plans
```

See **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** for the dependency rules and how to add a feature.

---

## 🧱 Architecture & Contributing

FixFlow is a **modular monolith** being grown into a product by a small team.
Before contributing, read:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the layer map (`app` / `shared` / `features`),
  dependency rules, state management, and how to add a new feature.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — branching model, commit conventions, and the PR checklist.
- **[`docs/SOLUTION-ARCHITECT-GUIDE.md`](./docs/SOLUTION-ARCHITECT-GUIDE.md)** — the _why_: business
  context, how capabilities are placed across the three runtimes, and decision frameworks.

`main` stays green: every pull request runs lint, format check, tests, and build via
GitHub Actions (`.github/workflows/ci.yml`).

---

## 🎯 Demo Walkthrough

The key manager flow to show: open the **Jobs** board → **New Job** → open it → **Set Estimate**
→ **Mark Approved** → **Mark Ready** → **Log Payment** → **Close**. The technician side of the
flow (clock-in, before/after capture, completion) is demoed from the **mobile app**.

---

## 📌 Out of Scope (currently)

No real SMS or payments, no supplier catalogue, no customer portal, and no
drag-and-drop scheduling. (Maps/GPS ARE real: the mobile app records GPS punches +
travel breadcrumbs on a live map, and the backend derives route distance + fuel.) The **Settings → Integrations** rows are demonstration placeholders
(labeled as such), marking where real services would plug in. The web console reads the live
FastAPI backend (via `src/shared/lib/api.js`) for **auth, jobs, and attendance**; a few surfaces
(**schedule**, the **workshop profile** form) remain demo data and are labeled in the UI.
