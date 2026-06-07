# Client Requirements — Gap Analysis (4 modules)

Source: client requirement images (Modules 1–4 + "Key Flags & Constraints").
Purpose: map each requirement to the **current** system, mark the gap, and call
out architectural changes. Principle (per direction): **extend the frontend we
have, add where necessary — do not rebuild from scratch.**

Legend: **🟢 Live** (built + deployed) · **🟡 Partial** (some of it exists / web-only / mock) · **🔴 Missing**.

---

## Module 1 — Attendance Management

| Requirement | State | Where we are / the gap |
| --- | --- | --- |
| Barcode scan check-in (at entrance) | 🔴 | Punch today = selfie + GPS. `attendance_event.source` enum already allows `mobile/kiosk/manual` — extensible to `barcode`, but there's no scan capability/UI. New: barcode/QR scan (kiosk or phone). |
| Face recognition check-in (biometric) | 🟡→🔴 | We capture a **selfie as evidence** ("flag, not proof"). We do **not** do biometric **identity matching**. True face-recognition (enroll + match + liveness) is a major new subsystem. |
| Geo-tagged at workshop | 🟡 | We capture GPS + `inside_geofence` + `distance_m` as a **flag**. Client says attendance "**must be marked at** the workshop" → implies **enforcement (block off-site)**, plus **real workshop coordinates** (today's geofence is a seeded placeholder). Policy decision needed: flag vs block. |
| Offline workability | 🟢 | Attendance is offline-first today (AsyncStorage queue + sync on reconnect). **Strong match.** |
| Connect attendance → ERP | 🔴 | No ERP integration. Needs an export adapter + the target ERP's format/API. |
| Auto-export attendance (no manual step) | 🔴 | No export job. |
| Upload to payroll every Sunday | 🔴 | No scheduler. Needs a weekly scheduled job (cron). Payroll was explicitly **deferred** before — now **required**. |
| Salary disbursed Sundays | ⚪ out-of-app | Disbursement is the payroll/ERP system's job; our scope is the clean weekly export. Confirm. |

---

## Module 2 — Complaint & Job Management

| Requirement | State | Where we are / the gap |
| --- | --- | --- |
| Company WhatsApp receives complaint | 🔴 | No WhatsApp integration. Needs WhatsApp Business API (Meta Cloud API or Twilio) **inbound webhook**. (SMS/WhatsApp was deferred.) |
| Manager/technician opens a Job → live Work List | 🟡 | Manager **create job + board are live on web**. Technician opening a job **on the phone** and a mobile Work List = not built (mobile is a 2-tab demo). |
| Notification dispatched to technician | 🔴 | No push. Needs Expo push notifications + device-token registry. |
| Dual assignment (manager-assign **OR** tech free-pick) | 🟡 | `assigned_tech_id` supports **manager-assign**. **Free-pick** (browse unassigned pool + "claim") needs a claim endpoint + a tech work-list UI. Both-at-once is achievable on our model. |

---

## Module 3 — SOP, Field Operations

| Requirement | State | Where we are / the gap |
| --- | --- | --- |
| Enter customer details before work | 🟢/🟡 | Web intake form + embedded customer fields on the job. On the **phone** before starting = not built. |
| **Before/after snapshots & video** | 🟢 | Media slice + mobile capture + web gallery (J3) are **live**. **Best match in the whole spec.** |
| GPS punch — workshop **departure** | 🔴 | We have *attendance* punches, not *per-job* location events. New: job-level departure pin. |
| GPS punch — customer **arrival** | 🔴 | New: job-level arrival pin. |
| Route recorded (workshop → customer) + fuel | 🔴 | New: route between the two pins + distance → fuel. (Two pins + a routing/distance call; continuous tracking is heavier — scope with client.) |
| Completion form: **Materials used** | 🟡 | Web prototype's **Estimate (parts)** overlaps but is a quote, not a completion log. Needs a real completion form field. |
| Completion form: **Time spent** | 🔴 | No on-site time field. |
| Completion form: **Travel/fuel expense** | 🔴 | No fuel field (ties to the route above). |
| Completion form: **Remarks — text OR audio** | 🟡 | Text notes = **live** (job timeline). **Audio note = missing** → extend media to an `audio` type + record/playback. |
| **Closing video required on closure** | 🟡 | Video capture exists; **closure-gating** ("can't close without a closing video") + a `closing` media phase do not. |

---

## Module 4 — Billing & Accounting

| Requirement | State | Where we are / the gap |
| --- | --- | --- |
| Bill auto-generated on completion-form submit | 🟡 | Web prototype has **Estimate → total** (≈ original bill) but no auto-generate-on-completion, and money has **no backend yet** (planned as J4, integer paisa). |
| **Original vs Negotiated bill (both stored, reportable)** | 🔴 | **Critical / hard requirement.** Two separate amounts. Net-new billing fields. |
| Bill delivered via WhatsApp | 🔴 | WhatsApp **outbound** (depends on the same integration as Module 2 intake). |
| **No company branding** on the bill message | ⚠️ | Template constraint + a **client clarification** (regulatory/privacy/operational?). |
| Cash received logged against job | 🟡 | Web prototype **Payment (cash/card, owed/paid/balance)** mock; no backend. |
| Each payment → revenue/accounting record | 🔴 | No revenue ledger. |
| Resubmission/correction of revenue entries | 🔴 | Not built — **but our append-only `attendance_adjustment` audit pattern is a perfect template** for correctable revenue. |

---

## Cross-cutting "Key Flags & Constraints"

| Constraint | State | Note |
| --- | --- | --- |
| **Offline non-negotiable** (attendance, job logging, forms) | 🟡 | Attendance + media are offline today. **Job logging + completion forms + submissions are not.** Architectural shift: generalize the per-feature queues into **one offline outbox/sync layer** so every write (job, form, bill, cash) is offline-capable. **Biggest cross-cutting change.** |
| Dual assignment model | 🟡 | See Module 2 (claim endpoint + tech work list). |
| Bill negotiation logging (original vs negotiated) | 🔴 | Hard accounting requirement — two reportable fields. |
| No-branding bill | ⚠️ | Confirm intent with client. |
| Audio note on completion | 🔴 | Extend media to audio. |
| Sunday payroll cycle | 🔴 | Scheduler (weekly cron) + ERP/payroll export format. |
| Closing-video on closure | 🟡 | Closure gate + storage/compression/size policy (client to confirm limits/cost). |
| Dual GPS punch + route | 🔴 | Per-job geo (departure + arrival) + route/fuel. |

---

## New subsystems / architectural changes (net-new vs the spine we have)

1. **Integrations edge** — keep as adapters at the boundary (mirrors our R2 storage adapter):
   - **WhatsApp** Business API: inbound webhook (complaint → job) + outbound (bill). Single biggest external surface.
   - **ERP export** + **weekly scheduler** (Sunday): scheduled job (Railway cron / APScheduler / external trigger) + export format.
2. **Generalized offline outbox** (mobile) — one durable write-queue powering job logging, completion forms, cash, and bills offline (today only attendance/media are offline). **The most important architectural decision.**
3. **Per-job geo** — `job_location` (departure/arrival pins) + route + fuel; reuses the attendance GPS/geo primitives.
4. **Work-completion form** — a structured entity on the job (materials[], time_spent, fuel, remarks_text, remarks_audio_path); drives auto-bill.
5. **Billing & revenue** — `original_amount` / `negotiated_amount` (paisa) + an **append-only, correctable revenue ledger** (reuse the adjustment audit pattern). This is J4, **expanded**.
6. **Media extensions** — `audio` type (voice remarks) + `closing` phase + closure gating.
7. **Biometrics** — face recognition (enroll/match/liveness). Heavy; likely a service + on-device. Scope/feasibility with client.
8. **Barcode check-in** — new attendance method (kiosk or phone scan).
9. **Push notifications** — Expo push + device-token registry.
10. **Mobile build-out** — the phone must grow from 2 tabs (Clock + Media) to the full technician app (Work List, Job Detail, GPS punches, completion form, audio, bill negotiation, cash). **This is the single largest effort** and gates a *live* demo of Modules 2–4 on the device (each change = an EAS rebuild + reinstall).

### What maps onto the existing frontend (reuse, not rebuild)
- Before/after capture, job timeline, manager board, attendance board+selfie/GPS — **already there.**
- Completion form, original-vs-negotiated, cash/revenue, work-list-claim, GPS-punch/route view, audio playback, closing-video gate — **new screens/fields that reuse the existing web design system** (shared UI primitives + the prototype's JobDetail/Estimate/Payment patterns). The web prototype already designs ~60% of Module 3/4 (Estimate≈materials/original-bill, Payment≈cash) — we extend, we don't restart.

---

## Needs client clarification (before/at implementation)
1. **WhatsApp**: provider (Meta Cloud API vs Twilio), is the Business number verified, who hosts the webhook?
2. **No-branding bill**: regulatory, privacy, or operational? (affects template + compliance).
3. **Closing video**: max length/size, compression target, storage budget (R2 cost).
4. **Face recognition**: required accuracy/liveness? on-device vs cloud service? privacy/consent for biometrics?
5. **ERP**: which system, export format/API, field mapping?
6. **Payroll**: which system, expected file/format, what exactly "upload" means.
7. **Geofence**: real workshop lat/long + radius; **enforce (block) or flag** off-site punches?
8. **Barcode**: what's encoded (per-tech badge scanned at a kiosk, or tech scans a fixed workshop code)?

---

## Reconciling with the existing roadmap
The prior plan (`jobs-vertical-plan.md`) deferred **Payroll** and **SMS** and ordered J4 money → J5 mobile → J6 schedule. The new requirements **promote** Payroll/ERP and WhatsApp from "deferred" to "required," and add **face-recognition, barcode, per-job GPS/route, completion form, audio, original-vs-negotiated billing, revenue ledger**. The money slice (J4) becomes "billing + negotiation + revenue." Mobile build-out (J5) becomes the critical path for any *live* phone demo.

## Demo strategy (fast)
- **Tier A — show live (already real):** offline attendance + selfie + GPS flags, before/after capture, job timeline/lifecycle, manager job board.
- **Tier B — fast web-prototype additions (front-end, mock/light-API) to show the full vision:** completion form (materials/time/fuel + **audio record/playback in-browser**), **original vs negotiated** bill + cash/revenue with corrections, **dual-assignment work list + claim**, **GPS departure/arrival pins + route map view**, closing-video-required gate, WhatsApp-intake mock card.
- **Tier C — heavy / needs client input / post-demo:** real WhatsApp in/out, ERP + Sunday automation, face recognition, push, true route+fuel, full live mobile build.

> Be explicit in the demo about **real vs prototype** so expectations stay honest.
