# FixFlow — Workshop Technician Management System

A clickable **strawman prototype** for a small home-appliance repair workshop in **Karachi, Pakistan**
(AC, washing machine, refrigerator, microwave repairs). It manages technicians, jobs, attendance,
scheduling, and the full carry-in repair lifecycle across a **manager desktop view** and a
**technician mobile view** — all from a single app.

> ⚠️ **Prototype only.** Everything runs on in-browser mock data. There is no login, no server, and no
> real SMS or payment processing. Anything you create or change persists while the tab is open and
> **resets on refresh**. The purpose is to demo the product shape and gather feedback.

---

## ✨ Features

- **Two roles, one app** (no login — toggle in the header):
  - **Manager** — desktop, left-sidebar shell, full shop overview.
  - **Technician** — mobile, bottom-tab shell, shown inside a phone frame on desktop. Built for
    quick taps with ≥44px touch targets.
- **Live Dashboard** — KPIs (present today, active jobs, awaiting parts, revenue this week), a
  *Needs Attention* alert strip, and a recent-activity feed.
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
  *Add to Job* shortcut that drops a part straight onto a job's estimate.

---

## 🛠 Tech Stack

- **React** + **Vite**
- **Tailwind CSS** (v4, via the Vite plugin)
- **React Router** (the URL prefix drives the role — anything under `/tech` is the technician view)
- **lucide-react** icons
- **Plus Jakarta Sans** typeface
- App state lives in a single **React Context** (`src/context/AppContext.jsx`)

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
# production build
npm run build
npm run preview
```

---

## 📁 Project Structure

```
src/
  main.jsx, App.jsx, index.css
  context/AppContext.jsx        # single state store + all mutators
  data/                         # mock data: jobs, technicians, attendance,
                                #            faultCodes, commonFixes, schedule, constants
  lib/                          # currency, date, statusConfig, job helpers
  components/                   # shared UI kit (cards, chips, badges, overlays, …)
  layouts/                      # ManagerLayout, TechLayout, PhoneFrame
  pages/
    manager/                    # Dashboard, Jobs, Technicians, Attendance, Schedule, …
    tech/                       # My Jobs, Clock In, Diagnose, Profile, My Week
docs/                           # demo documentation (PDF + source HTML)
```

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
