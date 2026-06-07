# Technician SOP — Phase 2 & Phase 3 plan (hand-off spec)

Durable, self-contained plan so any agent can execute it cold. Phase 2 may
start on the owner's go; **do NOT start Phase 3 until the owner says so** (it's
fully specified here for reference).

## Where we are (done)
- **Mobile app** (`technician-app/`, Expo, react-navigation): login + token, **My Jobs / Work List / Claim**, **Clock in/out** (offline), **Job Detail** with: note, mark ready/close, **before/after photo+video capture bound to the job** (M3b, keyed on `job.token`). First APK built under `@instant_fidelity/fixflow-technician`.
- **Backend** (FastAPI + Supabase + R2): `jobs` (job + `job_event` timeline + assign/claim), `media` (R2 signed up/down), `attendance` (offline punches + audit adjustments), `identity` (JWT). Auth enforced (J0.5b). Migrations-on-deploy, last migration **0006**.
- **Manager web** (`src/`, prototype): D1 **bill (original vs negotiated) + cash/revenue ledger** and D2 **completion form + audio** exist **but as in-session, web-only mock** (`LOCAL_ONLY_FIELDS` in `AppContext.jsx`). **Not persisted.** This is the key thing Phase 2 makes real.

## What Phase 2/3 deliver (the missing SOP, mapped to requirements)
| Requirement (module) | Phase |
| --- | --- |
| Work completion form: materials, time, fuel (M3) | 2 |
| Remarks **audio note** (M3 — "text OR audio") | 2 |
| **Bill: original vs negotiated**, both stored & reportable (M4) | 2 |
| **Cash collected / revenue** + corrections (M4) | 2 |
| GPS punches (workshop departure + customer arrival) + route/fuel (M3) | 3 |
| **Closing video required** on close (M3) | 3 |

---

## Locked architecture decisions (read before coding — these are the pitfalls)

1. **Money is integer paisa.** Every amount (materials, labour, fuel, bill, cash) is an integer in paisa, end to end. Never floats. Compute in paisa with integer math. API fields named `*_paisa`.
2. **Single source of truth = the backend.** D1/D2's web-local bill/completion/revenue **must move to the backend** in Phase 2. The phone writes them; the manager web *reads the same API*. **Pitfall:** leaving the web on `LOCAL_ONLY_FIELDS` while the phone writes to the DB → two diverging truths. Phase 2 includes rewiring the web cards to the API and removing those local-only fields.
3. **Media keying stays on `job.token`** (string) for before/after **and** the Phase 3 closing video, matching the web J3 gallery (`GET /api/jobs/{token}/media`). Do **not** churn to UUID now — it's consistent web↔mobile and low-risk. (Tech-debt note: the "right" key is the job UUID; defer.)
4. **Reuse the media slice for all R2 artifacts.** Audio voice note (Phase 2) and closing video (Phase 3) are **`job_media` rows**, not new tables — extend the `phase`/`type` enums. Reuses the entire signed-upload + size-check + playback pipeline.
   - Add `type = "audio"` (alongside video/photo) and `phase = "remark"` (voice note) and `phase = "closing"` (closing video). One migration updates the `CheckConstraint`s + the Python `StrEnum`s + the Pydantic `Literal`s.
5. **Offline = one generalized "job-action outbox" on the phone**, not N feature queues. A single AsyncStorage FIFO of `{client_id, jobId, kind, payload, done}` flushed on reconnect + app-foreground (generalize `attendance/queue.ts` + `sync.ts`). **Pitfall — double-charging:** every mutating action carries a **`client_id` (UUID)** and the backend **dedups on it** (esp. payments). Completion is upsert-idempotent (one per job); bill-negotiate is set-idempotent.
6. **Append-only money ledger.** Cash is a `job_payment` ledger; corrections **void** a row (with reason) and re-log — never edit/delete (mirrors `attendance_adjustment`). Reportable: both original & negotiated bill, and every payment incl. voided.
7. **Auth on every new endpoint** (router-level `Depends(get_current_principal)`, flat permissions). `actor = principal.tech_id`.
8. **EAS rebuild cadence.** A rebuild is needed only when **native deps change**:
   - Phase 2 adds **`expo-audio`** (voice recording) → **rebuild required**.
   - Phase 3 uses **existing** `expo-location` + `expo-image-picker` → **no new native dep → no rebuild** (JS-only; ships in the next build).
   - **Always run `npx expo export --platform android` before an EAS build** to catch Metro resolution errors that `tsc`/`jest` miss (the expo-font lesson).
9. **Migrations** are sequential hand-written Alembic files: 0007 → 0008 → 0009 → 0010, each `down_revision` chained. Money columns `BigInteger`.

---

## PHASE 2 — Complete the job → bill → cash (on the phone + persisted + web oversight)

### P2.0 — Cleanup (do first, tiny)
- **Remove the standalone Media tab.** Delete `MediaScreen.tsx`; drop it from `App.tsx` tabs (→ My Jobs · Clock · Profile). Capture already lives in Job Detail. `JobMediaCapture` stays (used by Job Detail). Update the Media-tab Feather icon map. Gate: typecheck + jest + `expo export`.
- PR, mobile-only, **no rebuild yet** (bundle into the P2 rebuild).

### P2a — Backend: completion + bill (migration 0007)
- **Tables/columns:**
  - `job_completion` (1:1 with job): `id` PK · `job_id` FK→job **unique** · `time_spent_mins` Int · `fuel_paisa` BigInt default 0 · `remarks_text` String(2048) null · `remarks_audio_media_id` UUID null (FK→job_media, the voice note) · `submitted_by` String(64) · `submitted_at` tz-aware.
  - `job_material`: `id` PK · `completion_id` FK→job_completion · `name` String(128) · `qty` Int · `unit_paisa` BigInt.
  - `job` += `bill_original_paisa` BigInt null · `bill_negotiated_paisa` BigInt null · `bill_status` String(16) default `'none'` (`none|generated|negotiated`).
- **Service:** `submit_completion(job_id, body, actor)` → upsert completion + replace materials → compute `bill_original_paisa = Σ(qty*unit) + round(time_spent_mins/60*RATE_PAISA) + fuel` → set `bill_status='generated'` → append `job_event(kind='complete', text='Work completed — bill Rs X')`. `negotiate_bill(job_id, amount_paisa, note)` → set `bill_negotiated_paisa`, `bill_status='negotiated'`, event `kind='bill'`.
  - `RATE_PAISA` = labour rate (config; default 1200_00 = Rs 1200/hr).
- **Endpoints** (auth):
  - `POST /jobs/{id}/completion` body `{materials:[{name,qty,unit_paisa}], time_spent_mins, fuel_paisa, remarks_text?, remarks_audio_media_id?, client_id}` → 200 `JobDetail`.
  - `POST /jobs/{id}/bill/negotiate` body `{amount_paisa, note?, client_id}` → 200 `JobDetail`.
- **Schemas:** extend `JobDetail` to embed `completion` (+materials) and `bill {original_paisa, negotiated_paisa, status}`.
- **Tests:** service (bill math in paisa, upsert replaces materials, idempotent on client_id), router (200 + auth-required + paisa validation), integration (real DB round-trip).

### P2b — Backend: cash/revenue ledger (migration 0008)
- **Table** `job_payment` (append-only): `id` PK · `job_id` FK→job · `client_id` UUID **unique** (idempotency) · `amount_paisa` BigInt · `method` String(16) (`cash|card|online`) · `recorded_by` String(64) · `recorded_at` tz · `voided` Bool default false · `void_reason` String(256) null.
- **Endpoints:** `POST /jobs/{id}/payments` `{amount_paisa, method, client_id}` (dedup on client_id) → `JobDetail`; `POST /jobs/{id}/payments/{pid}/void` `{reason}` → `JobDetail`. Embed `payments[]` + derived `received_paisa`/`balance_paisa` in `JobDetail`.
- **Tests:** dedup on client_id (no double-charge), void excludes from total, auth, integration.

### P2c — Backend: audio (voice note) via media (migration 0009)
- Extend `job_media`: `type` enum += `audio`; `phase` enum += `remark` (and `closing` now too, to avoid a second migration — used in P3). Update `CheckConstraint`s, `StrEnum`s, Pydantic `Literal`s.
- No new endpoint — the phone uploads the voice note through the **existing** `POST /jobs/{token}/media` (type=audio, phase=remark) → gets a `media_id` → passes it to `POST /jobs/{id}/completion` as `remarks_audio_media_id`.
- **Tests:** media accepts type=audio/phase=remark; completion links the audio.

### P2d — Mobile: "Complete Job" screen + voice note (rebuild #1 of Phase 2)
- New deps: `npx expo install expo-audio` (recording). `app.json` already has `RECORD_AUDIO`. **Native → rebuild.**
- New `src/features/jobs/CompleteJobScreen.tsx` (pushed from Job Detail): materials editor (name/qty/unit in **Rs**, converted to paisa on submit), time-on-site (min), fuel (Rs), text remark, **voice note recorder** (`expo-audio`: record→stop→playback; uploads as media type=audio → media_id). Submit → `jobsApi.submitCompletion(...)`. Shows the generated bill total.
- **Offline:** queue completion via the generalized outbox (`client_id`); audio upload is best-effort (the completion can submit with text only; audio attaches when it uploads).
- Job Detail gains a **Bill** card (Original vs Negotiated) + **"Complete Job"** button (hidden once completed → shows summary + "Edit").

### P2e — Mobile: negotiate bill + collect cash
- Bill card: "Enter negotiated amount" → `jobsApi.negotiateBill`. **Cash & Revenue** card: "Log payment" (amount Rs→paisa, method) → `jobsApi.logPayment` (outbox + client_id); per-entry "Correct" → void+reason. Owed/Received/Balance from the API. Offline-queued.

### P2f — Web oversight: rewire D1/D2 to the API (the single-source-of-truth fix)
- `mapJob.js`: read `bill`, `completion`, `payments` from the API `JobDetail` (paisa→display). **Remove** `bill/revenue/completion/payment` from `LOCAL_ONLY_FIELDS` in `AppContext.jsx`.
- `AppContext` mutators `setNegotiatedBill` / `logPayment` / `voidRevenueEntry` / (new) `submitCompletion` → call the API + `replaceFromDetail`, like the J2b lifecycle mutators (not local `patchJob`).
- The manager now sees exactly what the technician submitted. Keep `formatPKR` (paisa→"Rs"). Vitest updates.

**Phase 2 rebuild:** one EAS build after **P2d+P2e** (audio is the only native add). P2f (web) ships independently.

**Phase 2 slice/PR order:** P2.0 → P2a → P2b → P2c → P2d → P2e → P2f. Backend slices deploy (railway up) as they merge; mobile slices ship in the rebuild after P2e.

---

## PHASE 3 — GPS SOP + closing video (DO NOT START until owner says go)

### P3a — Backend: GPS punches + route (migration 0010)
- **Table** `job_location`: `id` PK · `job_id` FK→job · `client_id` UUID unique · `kind` String(16) (`depart_workshop|arrive_customer`) · `lat`/`lng` Float · `accuracy_m` Float null · `is_mock` Bool default false · `captured_at` tz · `device_time` tz null.
- **Service:** record punch; when both pins exist, compute `route_distance_m` (haversine — reuse `attendance/derive.py haversine_m`) → `fuel_estimate_paisa = distance_km * FUEL_RATE_PAISA_PER_KM` (config). Embed `locations[]` + `route {distance_m, fuel_paisa}` in `JobDetail`. Append `job_event(kind='gps')`.
- **Endpoint:** `POST /jobs/{id}/locations` `{kind, lat, lng, accuracy_m?, is_mock, device_time?, client_id}` → `JobDetail`.
- **Tests:** haversine, fuel calc, dedup, mock-flag stored, integration.

### P3b — Mobile: GPS punch buttons (JS-only — no rebuild)
- Job Detail SOP: **"Punch — leaving workshop"** and **"Punch — arrived at customer"** buttons (reuse `attendance/location.ts` `expo-location` + `mocked` flag) → `jobsApi.recordLocation` (outbox + client_id). Show captured pins + route distance + fuel estimate. Offline-queued.

### P3c — Backend: closing-video gate
- Closing video = `job_media` row `phase='closing'` (enum added in P2c). 
- **Service `transition(action='close')`** now **requires** ≥1 `closing` media row for the job, else raise `JobActionError("a closing video is required to close")` → 400. (Offline-tolerant: accept a *pending* closing row, not necessarily uploaded.)
- **Tests:** close without closing video → 400; with → 200.

### P3d — Mobile: closing video on close (JS-only — no rebuild)
- Job Detail: "Close job" first prompts **"Record closing video"** (existing `expo-image-picker` video → media phase=closing) → then `transition('close')`. Block close until a closing video is captured/queued.

### P3e — Web oversight: show GPS/route + closing video
- Manager JobDetail: a **Route** card (two pins + distance + fuel) and the closing video in the media gallery (phase=closing). Read-only.

**Phase 3 rebuild:** **none needed** unless a new native dep sneaks in (it shouldn't). Ships in the next routine build.

**Phase 3 slice/PR order:** P3a → P3b → P3c → P3d → P3e.

---

## Pitfalls checklist (verify each before merging the relevant slice)
- [ ] All money is integer **paisa**; no floats anywhere; API fields `*_paisa`.
- [ ] Every mutating action carries a **`client_id`**; backend **dedups** (no double cash).
- [ ] D1/D2 web fields **removed from `LOCAL_ONLY_FIELDS`** and rewired to the API (P2f) — no dual source of truth.
- [ ] Media keying stays on **`job.token`** (web↔mobile consistent).
- [ ] Audio/closing-video reuse the **media** slice (no new R2 plumbing).
- [ ] Offline outbox preserves **order**; failures stay queued; flush on reconnect + foreground.
- [ ] Each new table = a chained Alembic migration; `alembic check` passes (CI drift guard).
- [ ] Run **`npx expo export --platform android`** before every EAS build.
- [ ] Backend redeploy (`railway up`) after each backend slice merges; verify endpoint live.
- [ ] Closing-video gate is **offline-tolerant** (pending row counts).
- [ ] `tech` flat-permissions auth on every new endpoint.

## Verification per slice
- Backend: `ruff · mypy · pytest (unit + integration)` + `alembic check`. Deploy → curl the new endpoint.
- Mobile: `typecheck · jest · expo-doctor · expo export`. After a rebuild: on-device run of the new flow.
- Web: `lint · format · vitest · build`.

## EAS build runbook (reference)
- Project: `@instant_fidelity/fixflow-technician` (id `eb1d2f9f-…`), token in gitignored `technician-app/.eastoken`.
- `export EXPO_TOKEN=$(cat technician-app/.eastoken) && npx eas-cli build --profile preview --platform android --non-interactive --no-wait` → APK under `expo.dev/accounts/instant_fidelity/...`.
- Poll: `eas-cli build:list --platform android --limit 1 --json` (NOT `build:view --json` — it doesn't emit JSON).
- After the APK is installed + verified, **then** deploy any coupled backend lockdown.
