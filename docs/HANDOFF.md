# FixFlow — Project Handoff & Context (2026-06-08)

Single-source context to resume work in a fresh chat. FixFlow = workshop technician
management for a Karachi appliance-repair shop. Modular monolith, 3 runtimes.

---

## 1. Access & links

| Thing | Link / location |
| --- | --- |
| **GitHub repo** | https://github.com/Tempest-Zero/EMS_workshop1 |
| **Backend API (prod, Railway)** | https://efficient-tenderness-production-2d09.up.railway.app |
| **API docs (Swagger)** | …`/docs`  ·  raw: …`/openapi.json` |
| **EAS builds (APKs)** | https://expo.dev/accounts/instant_fidelity/projects/fixflow-technician/builds |
| **Latest APK — v10 (audio fix only)** | https://expo.dev/artifacts/eas/aMFYezDKCsc2fsCPT88tPZ.apk |
| **APK — v12 (full demo build: audio + outbox + push)** | https://expo.dev/artifacts/eas/k1YDiowqHjWfLT7yqUHYZR.apk |
| **Manager web (public, LIVE)** | **https://web-production-fd7de.up.railway.app/** — own Railway service (`web`), points at the prod backend. Demo login: PIN `1234`. |
| **Manager web (local)** | `npm run dev` (Vite, http://localhost:5173); `.env.local` sets `VITE_API_URL` to prod. |
| Railway project | `efficient-tenderness` (env `production`) — **two services**: `efficient-tenderness` (backend/FastAPI) + `web` (Vite SPA, Dockerfile.web). |
| EAS project | `@instant_fidelity/fixflow-technician` (projectId `eb1d2f9f-2427-4aaf-934b-0e996b290692`) |
| Firebase (FCM) project | `fixflow-app-5d0a8` (Android app `com.fixflow.technician`) |

**Demo login:** technician app + manager web → pick a tech, **PIN `1234`**.

---

## 2. The 3 runtimes

- **Web manager** (`src/`): React 19, Vite 6, Tailwind v4, React Router 7, Vitest. Single `AppContext`. Gates: `npm run lint` · `npm run format:check` · `npm test` · `npm run build`.
- **Mobile technician** (`technician-app/`): Expo SDK 52, RN 0.76, TS strict, React Navigation, Jest, Android-only. Tabs: My Jobs · Clock · Profile. Gates: `npm run typecheck` · `npm test` · `npx expo export --platform android` · `npx expo-doctor`.
- **Backend** (`backend/`): FastAPI, Python 3.12, SQLAlchemy 2.0 async, asyncpg, Alembic, boto3, PyJWT, httpx, Ruff, Mypy strict, Pytest. Slice-per-folder (router/service/repository/schemas/models/tests). Gates (use the venv `backend/.venv/Scripts/python.exe`): `ruff format --check .` · `ruff check .` · `mypy app` · `pytest app` (unit). DB gates (`alembic upgrade head`, `alembic check`, `@integration` tests) run in **CI** against a throwaway Postgres.

---

## 3. Current state — requirements coverage (client brief: 4 modules)

**Built & live (real, end-to-end):**
- **M1 Attendance:** offline clock-in/out + selfie + GPS; geofence **flag** (live, real coords `33.65564, 72.8543`, 80 m, `is_active=true`, flag-only by design); **weekly payroll CSV export** + manager download.
- **M2 Jobs:** live work list (web board + mobile My Jobs/Claim); **dual assignment** (manager `/assign` + tech `/claim`); **push-on-assign** (FCM direct from backend).
- **M3 SOP:** customer details; before/after media; GPS depart+arrive punches → route + fuel; completion form (materials/time/fuel); **voice-note remark** (expo-av); **closing-video-required gate**.
- **M4 Billing:** auto-bill on completion; **original vs negotiated** (both stored); cash ledger + corrections (void, append-only).
- **Cross-cutting:** **offline non-negotiable** met via a generalized outbox (completion/cash/punches/negotiate queue offline + sync); money = **integer paisa** end-to-end; every mutating action carries a **`client_id`** (backend dedups).

**Cut by owner (out of scope):** WhatsApp intake/bill delivery, barcode check-in, face recognition.

**Pending (operational, not build):**
- ✅ **PR #45** (FCM-direct push) — merged. ✅ **PR #46** (Pages) — merged, then **superseded** (we host on Railway, not Pages).
- Merge **PR #47** (web → Railway service) — removes the dead Pages workflow; the web is already **live** at https://web-production-fd7de.up.railway.app/ (deploy was done out-of-band, this PR just lands the Dockerfile.web/.dockerignore + cleanup). **Do NOT enable GitHub Pages** — we abandoned that path.
- **v12 APK** ready: https://expo.dev/artifacts/eas/k1YDiowqHjWfLT7yqUHYZR.apk — install for the full on-device demo (audio + outbox + push).
- **Web hosting note:** Railway `web` service builds `Dockerfile.web` (`RAILWAY_DOCKERFILE_PATH`) with build var `VITE_API_URL`=backend URL. Backend `FIXFLOW_CORS_ORIGINS` was extended to allow the web origin (JSON array; localhost dev origins kept). To redeploy the web after code changes: `railway up -s web` from repo root.
- **ERP upload final hop:** payroll **export** is built; the actual push into the client's ERP is a pluggable step pending their system/format. "Every Sunday" automation = same export on a Railway cron (not yet wired; export is on-demand today).

---

## 4. Open / recent PRs
- **#45** `feat/push-fcm-direct` — OPEN, gates green, **already deployed to prod**; merge to sync `main`.
- Merged: #41 offline outbox, #42 expo-av audio, #43 push (notifications slice), #44 payroll export, #32–36 Phase 3 (GPS/route/closing gate/web), #29–31 Phase 2 cash/web-rewire, etc.
- The owner merges PRs (protected `main`); the agent cannot merge. Each slice = its own PR.

---

## 5. Key architecture & decisions (locked)
- **Money = integer paisa** everywhere; API fields `*_paisa`; rupees only at the input boundary (mobile `money.ts`, web `currency.js` `rupeesToPaisa`/`paisaToRupees`). Web maps paisa→rupees in `mapJob.js`.
- **Idempotency:** every money/field write carries a `client_id` UUID; backend dedups → no double-charge/double-record.
- **Offline outbox** (`technician-app/src/lib/outbox.ts` + `outboxSync.ts` + `useOutboxSync.ts`): `sendOrQueue()` online-sends or queues; `flushOutbox()` drains on reconnect/foreground/backoff. Covers completion/payment/void/negotiate/location (all idempotent). Notes stay online-only.
- **Media keyed on `job.token`** (string), reused for audio (phase=remark) + closing video (phase=closing). `MediaList` now returns `before/after/closing`.
- **Append-only ledger** (`job_payment`): corrections void (with reason), never edit/delete.
- **Auth:** JWT HS256, `get_current_principal`, flat permissions. All tech/media/punch/jobs endpoints auth-guarded. `record_punch` is JWT-attributed: a `tech` can only punch as themselves; a `manager` may record for any tech.
- **Push = FCM HTTP v1 direct from backend** (NOT Expo relay): service account stored as Railway secret `FIXFLOW_FCM_SERVICE_ACCOUNT_B64` (base64 JSON); backend mints an OAuth token (PyJWT RS256) and POSTs to FCM v1. App registers the **native FCM device token** (`getDevicePushTokenAsync`). Best-effort; off if the secret is absent.
- **Geofence = flag-only** (never blocks); owner's decision.
- **Audio = expo-av** (`Audio.Recording`, HIGH_QUALITY → AAC/.m4a, browser-playable), NOT expo-audio (0.3.5 throws `IllegalStateException` on `stop()` — see lessons). expo-av is deprecated in SDK 52 (works fine; migrate to fixed expo-audio at SDK 53). `expo-doctor` excludes `expo-av` in `package.json`.
- **Migrations:** sequential Alembic 0001→0011. Latest: 0010 `job_location` (GPS), 0011 `device_token` (push). Both applied in prod (`alembic_version=0011`). Railway **auto-runs `alembic upgrade head` on deploy**.

---

## 6. How to operate (runbooks)

**Deploy backend (Railway):** from `backend/`, `railway up --service efficient-tenderness --detach`. Auto-runs migrations. Verify: poll `…/openapi.json` for new routes, or query the DB via the app config. Secrets live in Railway Variables (never in repo). Railway CLI is logged in (Muhammad Bilal); set vars with `railway variables --set "KEY=VALUE" --service efficient-tenderness`.

**Cut an EAS build (APK):** from `technician-app/`, `export EXPO_TOKEN=$(cat .eastoken)` then `npx expo export --platform android` (sanity) then `npx eas-cli build --profile preview --platform android --non-interactive --no-wait`. versionCode auto-increments (`appVersionSource: remote` + `autoIncrement`). Poll with `eas-cli build:list --platform android --limit 5 --json` (NOT `build:view`). **The free-tier EAS queue is SLOW (20–40 min queued).** The preview profile bakes in `EXPO_PUBLIC_API_URL` = prod backend. Rebuild only when native deps change OR to ship JS to the device (no OTA configured).

**Secrets handling:** `technician-app/.eastoken` (EAS token, gitignored). Firebase admin key lives in the owner's Downloads + as the Railway base64 secret — **never in git/chat**; `.gitignore` blocks `*firebase-adminsdk*.json`. `backend/.env` (gitignored) has the Supabase URL + JWT secret (used locally to query prod DB read-only for verification).

**Cloud:** Supabase Postgres (ap-south-1, session pooler, +asyncpg) · Cloudflare R2 (`job-media` bucket, signed PUT, $0 egress) · Railway (deploy, NOT GitHub-connected — manual `railway up`) · Expo EAS · GitHub Actions (3 parallel CI jobs: frontend, mobile, backend).

**Conventions:** commit trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; PR footer `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## 7. Lessons / gotchas (hard-won)
- **expo-audio 0.3.5 recorder is broken on-device** (Android `IllegalStateException` on `stop()`), regardless of audio-focus / options / mono. Root cause = the library. **Fix: expo-av.** Don't reach for expo-audio recording on SDK 52.
- **Stereo AAC** can make the Android encoder reject `stop()` — voice notes are **mono**.
- **Deploy coupling (the J0.5b lesson):** never deploy a *gate/lockdown* (auth, closing-video gate) before the client build that can *satisfy* it is installed, or you brick the flow.
- **EAS `credentials` is interactive-only** — can't script the FCM key upload; that's why push was reworked to backend-direct FCM (secret in Railway).
- **Bash `git commit -m @'…'@`**: an apostrophe in the message closes the quote and breaks it — keep commit messages apostrophe-free or use `-F file`. PR bodies: use `--body-file` (backticks/apostrophes break `gh pr create --body`).
- **Bash tool cwd** can be unreliable across calls — prefer absolute paths or `git -C <path>`.
- **Migrations auto-apply on Railway deploy** (confirmed: 0010/0011 applied post-deploy). No manual step.
- The stale gap-analysis doc (`docs/client-requirements-gap-analysis.md`) predates Phases 2–3 — this HANDOFF supersedes it.

---

## 8. What to do next
1. **Merge #45** (sync main to prod). 2. Grab the **v12 APK**, install, verify: audio record→stop→playback, offline outbox (airplane mode → complete/cash → reconnect → syncs), and **push** (assign a job on web → phone notification). 3. Optionally **deploy the manager web** for a public link. 4. **Phase 3 is fully done.** 5. Remaining real work is integrations the owner deferred (WhatsApp, real ERP/payroll upload, the Sunday cron) — all need owner credentials/decisions.
