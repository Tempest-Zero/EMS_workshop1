# FixFlow — Remediation Plan (pre-handover)

> Output of the full-project review on 2026-06-10 (code, structure, architecture).
> This is the **ordered** plan: each phase's position is load-bearing. Re-ordering
> phases can convert a safety fix into a data-loss mechanism — the reasoning for
> each ordering is written down so nobody "optimizes" the sequence later.

---

## 0. The three constraints that dictate the order

1. **The mobile pipe is slow and physical.** No OTA updates are configured; every
   mobile change = EAS build (20–40 min free-tier queue) + hand-installing the APK
   on each technician's phone. Therefore: batch mobile work into as few APK cuts
   as possible, and never assume old clients are gone.
2. **Backend gates punish old clients** (the J0.5b lesson in PLAYBOOK.md). A new
   server-side rejection must deploy **after** the client that handles it
   gracefully is installed everywhere.
3. **Some fixes are product decisions**, not engineering ones (estimate removal,
   payments-after-close policy, close-requires-completion). Owner sign-off rides
   the PR that implements them.

**The critical edge (why Phase 3 strictly precedes Phase 4):** the current mobile
outbox drops a queued write on ANY non-network error (`outboxSync.ts` treats every
HTTP failure as poison). The planned money status-guards reject writes against
closed jobs. Combined: a technician's offline cash payment, syncing after the
manager closed the job, would be rejected by the new guard and **silently deleted**
by the old outbox. The guard would manufacture the exact loss it exists to prevent.
The outbox fix must be installed on every phone before any money guard ships.

---

## Phase 0 — Config-only wins (an afternoon, no code)

**Do:**
- Move the Railway backend service region `sfo` → Southeast Asia (Singapore).
  Today every request does ~8 sequential SF↔Mumbai DB round trips (~210 ms each)
  plus Karachi↔SF client latency ≈ 2 s+ per tap. Singapore↔Mumbai ≈ 65 ms →
  roughly 3× faster for every user, zero code.
- Confirm `FIXFLOW_JWT_SECRET` is set in Railway (prerequisite for the Phase 1
  boot guard).
- Record before/after timings (`/api/health`, one job detail).

**Pitfalls:**
- The mobile APK has the API URL **baked at build time**. Verify the Railway
  public domain survives the region move (curl immediately after). If the domain
  changes → roll back, put a custom domain in front, then move.
- Do **not** follow up by "optimizing" `_detail` with `asyncio.gather`:
  SQLAlchemy `AsyncSession` is not concurrency-safe (asyncpg raises
  `InterfaceError: another operation is in progress`). If batching is ever needed,
  use ORM relationships + `selectinload` or one joined query. After the region
  move the ~6 sequential queries cost ~400 ms total — likely fine as-is.

---

## Phase 1 — Backend safety PR (backward compatible, deploy anytime) (~1–2 days)

No installed client is affected by any of this; it can ship while Phases 2–3 are
in flight.

**Do:**
- **Login throttling**: per-account exponential backoff (`failed_attempts`,
  `locked_until` on `technician`) + a coarse per-IP limit.
- **`token_version` groundwork**: column (default 0), `ver` claim in new tokens,
  checked in `get_current_principal`; `POST /technicians/{id}/revoke-sessions`
  (manager) bumps it. Lost-phone kill switch.
- **Set-PIN endpoint** (manager sets any; a tech sets their own) — retire the
  shared `1234`, and give the manager a 6-digit PIN.
- **Claim guard**: `/claim` returns 409 if `assigned_tech_id` is already set
  (guarded UPDATE … WHERE assigned_tech_id IS NULL — race-proof).
- **`log_payment` IntegrityError recovery** (copy the attendance pattern) so a
  concurrent duplicate dedups instead of 500ing.
- **`next_token`** → Postgres sequence (migration seeds it from `max(token)+1`).
- **FCM hygiene**: delete the device-token row on 404/410 (UNREGISTERED).
- **Boot guard**: refuse production boot with the dev JWT secret.
- **Sentry (backend) + request-ID middleware** (scrub PII from events).

**Pitfalls:**
- There is exactly **one manager account**. Lockout must decay (e.g. doubling
  30 s capped at 15 min), never hard-lock — otherwise a malicious tech can brick
  the console by spamming the manager's login, and you can lock yourself out
  mid-demo.
- Missing `ver` claim in old tokens must be treated as version 0 — every
  currently-logged-in device stays valid until a deliberate bump.
- Old mobile clients show a generic error for the claim 409 — acceptable; the
  friendly "already taken" message ships with the Phase 3 APK.

---

## Phase 2 — Web truth purge (2 PRs + structure lock) (~2–3 days)

**2a — real data only:**
- Unfreeze `TODAY` (`shared/config/constants.js` is hardcoded to `2026-05-30`,
  which kills the Dashboard aging alerts and freezes the header date). Make it
  derive from the real clock; tests inject a fixed date.
- Delete the fabricated `TechnicianDetail` payroll table (labelled "Synced with
  Payroll Service" — there is no payroll service), the hardcoded perf stats, and
  the static May-2026 attendance month; wire month dots to the real `/grid` API
  and compute perf from real jobs.
- Point every roster read at `useApp().technicians` (NewJobForm's assign
  dropdown, all `techById` call sites, `fetchBoard`'s id list). Today a sixth
  hire breaks these screens.
- Decide the Schedule page's fate (it is fully mock): hide the route for
  handover or label it clearly as a preview.

**2b — remove the illusions:**
- Remove the estimate UI + mutators (`setEstimate` etc. are client-side only and
  vanish on refresh; estimates are not in the client's four modules — removal is
  a product call, owner signs off on the PR).
- Delete dead code: `features/jobs/data/jobs.js` (1,034 lines), `clockIn`/
  `clockOut` in AppContext, `push.log`.

**2c — structure lock (after the purge, so the final graph is what gets linted):**
- `eslint-plugin-boundaries` (web) + `import-linter` (backend) in CI.
- Fix the three backend boundary breaks: media/notifications export their own
  `get_service` providers (jobs stops importing their repositories);
  `haversine_m` moves to `shared/`; identity is documented as the blessed
  cross-cutting slice.

**Pitfall:** much of the 67-test web suite is built on seed fixtures. Budget
half the phase for rewriting tests against API-shaped fixtures — they are the
regression net for Phases 3–5. Deploy via `railway up -s web` (mind the
`Dockerfile.web` cache-bust ARG gotcha; verify the served bundle changed).

---

## Phase 3 — THE mobile APK (one surgical cut) (~3–4 days incl. device testing)

Everything mobile rides this single build. **This phase gates Phase 4.**

**Do (all in `technician-app/`):**
- **Outbox v2** (`outbox.ts`, `outboxSync.ts`):
  - Typed `ApiError` carrying HTTP status from `request()`.
  - Classification: drop **only** on 400/404/409/422 — and "drop" now means
    *move to a visible failed-items list* (retry / confirm-discard), never
    silent deletion. Retry 5xx/429/timeouts/network. On 401: **pause** the
    queue (items survive logout), resume after re-login.
  - Tag items with `tech_id`; flush only items matching the current principal
    (shared-device protection).
- **Pending overlay** on Job Detail: render server state + queued items
  (pending payments appear in the ledger with a "syncing" badge; balance
  includes them; completion shows "pending sync"). Warn before logging a
  payment identical to one already pending. This — not idempotency — is what
  prevents offline double-charging: each tap mints a fresh `client_id`, so the
  server cannot dedup a doubting tech's second tap; only the UI can.
- `ready` + notes go through the outbox. **Close stays online-only,
  deliberately**: an offline close without its video uploaded would game the
  evidence gate; the honest fix is offline media queueing (Phase 6). HANDOFF's
  offline claim gets corrected accordingly.
- Friendly claim-conflict message for the Phase 1 409.
- **Sentry mobile** (needs a native build — that is why it rides this APK).
- **Do NOT bundle** the attendance-queue unification — it works; keep the
  money-path APK surgical.

**Pitfalls:**
- Storage migration `jobs.outbox.v1` → `v2` must **never discard the existing
  queue** — it may hold real cash records. Migrate in place (tag legacy items
  with the restored session's tech). Test the upgrade path with seeded v1 data.
- Test gate before cutting the build: classification-matrix unit tests; on
  device: airplane-mode E2E (complete → negotiate → pay → reconnect → ledger
  correct), kill-backend-mid-flush (5xx retained), expired-token (queue
  survives), v1→v2 upgrade.
- Rollout gate: every technician phone verified on the new version with an
  empty outbox after sync. **Phase 4 does not start until this is true.**

---

## Phase 4 — Money integrity (backend; ONLY after the Phase 3 rollout gate) (~2 days)

**Do:**
- **Status freeze**: `completion` submit + `negotiate` → 409 on closed jobs.
  **Payments stay accepted after close** but the event is flagged
  "received after close" — rejecting late-arriving cash loses real records;
  flag-and-report is the append-only philosophy applied correctly.
- **Close requires a completion row** (non-abandoned closes) — prevents
  manager-closes-early → tech's queued completion rejected → cash collected
  against a job that never billed. Behavior change; owner sign-off on the PR.
- **Labour-rate snapshot** on the completion row (migration backfills existing
  rows at the current rate) — the bill stops being repriceable by a config edit.
- **Negotiate history**: store the prior amount in the event (or a history row)
  so original-vs-negotiated reporting has provenance, not just current values.
- **Media delete policy**: *own media + job not closed* (+ manager override).
  **NOT manager-only** — the technician retake flow calls `deleteMedia`
  (`useMedia.ts:77`); manager-only would break every installed app.
- **`waiting` transition** (`wait` + reason) + web button — the board's Waiting
  lane finally becomes reachable.
- `closed_at` Date → timestamp (batch with this PR's migrations).
- Web: friendly 409 toasts for the new guards.

**Why strictly after Phase 3:** with the old outbox these guards silently
destroy queued offline writes (see §0). With outbox v2 a rejection lands in the
visible failed list, and Phase 5's reconciliation catches the remainder.

---

## Phase 5 — Time, evidence, operability (~2–3 days) — BUILT 2026-06-10

> Status: scheduler + Sunday payroll auto-export (R2 + manager list/download) +
> evidence-gaps endpoint/Dashboard alert shipped. **Deferred with reasons:**
> `openapi-typescript` in CI (the TS/JS clients must first adopt generated
> types or the step is theater — pair it with the next client refactor) and a
> periodic device-token prune sweep (Phase 1c already prunes reactively on
> FCM 404/410; a sweep adds nothing until token volume grows).

- **Scheduler seam**: in-process APScheduler (document the single-replica
  assumption — duplicate runs if ever scaled) or Railway cron. Pick one; then:
  - **Sunday payroll auto-export** → CSV to R2 + manager notification. The ERP
    *push* remains client-blocked (format/system unknown) behind the adapter.
  - **Evidence reconciliation**: closed jobs whose closing media is still
    `pending` after 48 h → flag + a Dashboard "evidence gaps" card. Today the
    close gate counts pending rows (right call for offline) but nothing ever
    verifies the bytes arrived — this closes that loophole.
  - Device-token prune sweep.
- **`openapi-typescript` in CI** — ends the hand-synced three-runtime contract
  (`mapJob.js` / `jobsApi.ts` drift becomes a build error).
- **Docs pass**: HANDOFF offline claim corrected; job dual-key (UUID vs token)
  documented; `shop_id` reality (param-supplied, not JWT-derived — multi-shop is
  NOT "mostly done"); concurrency = accepted last-write-wins risk register; new
  runbooks (region, lockout, revocation, PIN, cron).

---

## Phase 6 — Deferred on purpose (resist pulling these forward)

- Attendance queue → outbox unification (own device-test pass when touched).
- Offline media queue → enables true offline close.
- `JobDetail.jsx` (1,202 lines) / `JobDetailScreen.tsx` (760) splits — next time
  they're edited, not before.
- Per-shop timezone (today: `shifts[0].timezone` wins — a wrinkle, not a fire).
- Estimates as a real slice (only if the client asks), multi-shop/RLS.

---

## Sequencing rationale (the sabotage map)

| Edge | Reason |
|---|---|
| Phase 0 before any perf code | Region move may make query batching unnecessary; avoids the `asyncio.gather` session trap entirely. |
| Phase 2 purge before 2c lint | Lint the final import graph once, not twice. |
| **Phase 3 before Phase 4** | **Old outbox + new money guards = engineered silent cash loss.** The hard gate of the plan. |
| Media policy shaped in Phase 4 | Verified: manager-only delete would break the installed retake flow. |
| Sentry-mobile in Phase 3 | Needs a native build; ride the only planned APK. |
| Payments accepted after close | Rejecting late cash = losing records; flag-and-report preserves both audit and truth. |
| Attendance queue NOT in Phase 3 | Don't concentrate risk in the money-path APK; it works today. |

**Estimated total: 10–14 focused days.** Phases 1 and 2 can run in parallel with
Phase 3 development; Phase 4 is serialized behind the Phase 3 rollout gate.
