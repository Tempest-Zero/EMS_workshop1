# FixFlow — Workshop Technician Management System

A clickable **strawman prototype** for a small home-appliance repair workshop in **Karachi, Pakistan**
(AC, washing machine, refrigerator, microwave repairs). It manages technicians, jobs, attendance,
scheduling, and the full carry-in repair lifecycle across a **manager desktop view** and a
**technician mobile view** — all from a single app.

> ⚠️ **Prototype data, product foundation.** The web app currently runs on in-browser mock data — no
> login, no real SMS or payment processing, and changes **reset on refresh**. A FastAPI backend
> (Supabase-backed) is being wired in alongside it; an Expo technician app will follow. The codebase
> is structured as a **modular monolith with vertical slices spanning all three runtimes** (see
> [`ARCHITECTURE.md`](./ARCHITECTURE.md)) so a small team can grow it into the real product.

## 📦 Repo layout (monorepo)

```
EMS_workshop1/
  src/                # web manager app (React + Vite)        — this README's "Getting Started"
  backend/            # FastAPI + Alembic + Supabase           — backend/README.md
  technician-app/     # Expo (Android) — Phase 2               — technician-app/README.md
  docker-compose.yml  # local Postgres + backend dev stack
```

---

## ✨ Features

- **Two roles, one app** (no login — toggle in the header):
  - **Manager** — desktop, left-sidebar shell, full shop overview.
  - **Technician** — mobile, bottom-tab shell, shown inside a phone frame on desktop. Built for
    quick taps with ≥44px touch targets.
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

Then open the URL Vite prints (default **http://localhost:5173**).

- Manager view: `/`
- Technician view: `/tech/jobs`

```bash
# quality gates (the same checks CI runs)
npm run lint          # eslint
npm run format        # prettier --write .
npm test              # vitest

# production build
npm run build
npm run preview
```

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
docs/             # demo documentation (PDF + source HTML)
```

See **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** for the dependency rules and how to add a feature.

---

## 🧱 Architecture & Contributing

FixFlow is a **modular monolith** being grown into a product by a small team.
Before contributing, read:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — the layer map (`app` / `shared` / `features`),
  dependency rules, state management, and how to add a new feature.
- **[`CONTRIBUTING.md`](./CONTRIBUTING.md)** — branching model, commit conventions, and the PR checklist.

`main` stays green: every pull request runs lint, format check, tests, and build via
GitHub Actions (`.github/workflows/ci.yml`).

---

## 🎯 Demo Walkthrough

A full demo script and architecture/flow diagrams are in **`docs/FixFlow-Demo-Guide.pdf`**.
The key flow to show: open the **Jobs** board → **New Job** → open it → **Set Estimate** →
**Mark Approved** → **Mark Ready** (watch the SMS toast) → **Log Payment** → **Close**.

---

## 📌 Out of Scope (intentionally)

No authentication, no backend/database, no real SMS or payments, no supplier catalogue, no
customer portal, no maps/GPS, and no drag-and-drop scheduling. The dashed "🔗 integration" badges
mark where real services would plug in.
