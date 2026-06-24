# FixFlow — Product-Readiness Review (single-shop tool → sellable product + hardware)

> Output of the scope-reframe review on 2026-06-11. Prior reviews judged FixFlow as
> a production system for ONE workshop (`docs/REMEDIATION-PLAN.md`). The owner has
> now scoped it as a **future product** — multiple customer workshops, with
> **hardware integration** (attendance terminals, scanners, printers, trackers)
> later. This review asks a different question: *which assumptions are hardening
> into the foundation that a second customer or a hardware device will break?*
>
> Companion docs: `REMEDIATION-PLAN.md` (production blockers for customer #1 —
> still the prerequisite for everything here), `HANDOFF.md` (operational state).

---

## 0. The verdict in one paragraph

The architecture survives the reframe: a modular monolith with lint-enforced
vertical slices, idempotent writes keyed on `client_id`, integer-money, an
append-only ledger, and flag-never-block evidence semantics is the right shape
for this product at any plausible scale — do **not** microservice it. What does
NOT survive are six specific assumptions: an unversioned API, PKR baked into
wire-contract field names, a tenant-blind identity table and JWT, business
config living in env vars, a human-only principal model, and a request/response-
only integration surface. All six are cheap to stop deepening today and
expensive to excavate after the first external customer or device couples to
them. The compiled findings below are ranked by **cost-of-delay**, not severity.

---

## 1. Wire-contract liabilities (cheapest now, most expensive later)

The API contract is about to grow three classes of long-lived consumers that
cannot be redeployed at will: customer phone fleets, third-party hardware
firmware, and integration partners. Every day of delay adds consumers to the
current contract.

- **A1 — Unversioned API.** Every route lives at `/api/*` (`main.py` mounts all
  routers with `prefix="/api"`; no version segment anywhere). The mobile fleet
  already demonstrated the cost (the J0.5b deploy-coupling lesson); hardware
  firmware is worse — some devices never update. Introduce `/api/v1` while the
  total consumer population is five phones. Alias the old prefix during the
  transition; gate new consumers to versioned paths only.
- **A2 — Currency in field names.** `amount_paisa`, `unit_paisa`, `fuel_paisa`,
  `labour_rate_paisa` are the public contract (`jobs/schemas.py`). Integer
  minor-units is the right *model*; the *name* locks the product to PKR. A
  second-market customer (Gulf workshops are the obvious adjacency) means a
  breaking rename. Fold a `*_minor` rename + per-tenant `currency` into the
  same v1 versioning cut so the contract breaks once, not twice.
- **A3 — Human-assigned ID slugs.** `technician.id` is a seeded slug
  (`t1`…`t5`, string PK) referenced across jobs, attendance, payments, and
  inside JWTs. Tolerable, but generated IDs (UUID) for all new principal types
  — and for techs at the v1 cut — avoids slug-collision ceremony per tenant.

## 2. Tenancy is half-built — finish the half that's load-bearing

The attendance slice was explicitly built tenant-aware ("all stamped with
`shop_id` (RLS-ready; one shop for now)" — `attendance/models.py`) and jobs
carries `shop_id` too. The pattern exists in-repo; it just stops short of the
root:

- **B1 — `technician` (identity) has no `shop_id`.** The roster — the table
  every other scoping decision hangs off — is global. Tenant isolation starts
  at identity; this is the first migration of the product track. The public
  login-roster endpoint compounds it: today it enumerates *all* users, which
  becomes cross-tenant user disclosure the day shop #2 exists.
- **B2 — JWTs are tenant-blind.** Claims are `sub`/`role`/`name`/`tv`/`exp`
  (`identity/security.py:create_access_token`). Add a `shop` claim when B1
  lands so every request is scoped by token, not by lookup.
- **B3 — `job_media` and `device_token` lack `shop_id`.** Both are transitively
  scoped (via job / via tech), which is fine until RLS or per-tenant export is
  needed. Stamp them whenever those tables are next touched.
- **B4 — Business config lives in env vars.** `labour_rate_paisa`,
  `fuel_rate_paisa_per_km`, payroll cron + timezone, drift/accuracy thresholds
  (`core/config.py`) are *per-deployment* knobs, but they are *per-customer*
  facts — every workshop has its own rates, payroll day, and timezone. The
  geofence + shift editors already prove the right pattern (DB rows per shop,
  manager-editable). Extend it: a `shop_settings` table, starting with the two
  rates. Note the mitigation already in place: the labour rate is snapshotted
  per job (`JobCompletion.labour_rate_paisa`), so historical bills survive the
  move untouched.
- **B5 — The scheduler is single-tenant.** `_run_payroll_export` runs once for
  `DEFAULT_SHOP_ID` at a single global cron. Per-tenant payroll cycles require
  the Sunday job to fan out over shops (and stay idempotent per (shop, week) —
  the key already exists on `payroll_export`).
- **B6 — Isolation model: decide and write it down.** The implicit choice is
  pooled multi-tenancy (shared DB, `shop_id` column). That is the right v1.
  The decision that needs an ADR is *enforcement*: repository-level scoping
  audited by tests, vs Postgres RLS. Either is defensible; undocumented drift
  between them is not.

## 3. The principal model cannot represent machines

- **C1 — Roles are a closed human set.** `CHECK (role IN ('tech','manager'))`
  (`identity/models.py`) — a DB constraint, so widening it is a migration. No
  machine/service principals, no API keys. Every backend-talking device
  (attendance terminal, vehicle tracker) currently has nothing to authenticate
  *as*. The product needs a principal abstraction: human (PIN→JWT, exists),
  device (long-lived key/mTLS, revocable, least-privilege), service (ERP
  adapter, exists informally).
- **C2 — Punch evidence is phone-shaped.** Attribution is "tech punches self,
  manager punches anyone"; evidence is selfie + GPS + device-clock drift. A
  biometric terminal is a third mode: a *device* punching on behalf of a human,
  with template-match score instead of selfie and a fixed location. The deep
  design — flag-never-block, drift detection, `client_id` idempotency —
  generalizes beautifully; the *columns* don't yet (selfie non-null
  assumptions, no `source` discriminator, no structured evidence field).
- **C3 — There is no device registry.** `device_token` is FCM-push-only. A
  registry (device id, type, owner shop, last-seen, app/firmware version,
  health) is needed for hardware onboarding later — and would solve the
  **fleet-state problem the mobile app has today** (the "which phone runs which
  APK" gate that blocked Phase 4). One primitive, two payoffs; this is the one
  piece of "future" infrastructure with an immediate return.

## 4. Integration surface is request/response only

- **D1 — No outbound event seam.** WhatsApp bill delivery, ERP push, hardware
  reactions, customer notifications — all are "when X happens, tell Y", and
  the system has no way to say it. `job_event` is the embryo: append-only,
  indexed, already written at every state change — but text-shaped
  (`kind` + `text(1024)`), job-scoped, with no structured payload and no global
  cursor. Evolution path (no new infrastructure): add a JSONB payload + global
  sequence → treat it as a transactional outbox → one dispatcher loop delivers
  webhooks with retries. Postgres carries this for years; do not buy a queue.
- **D2 — No realtime channel.** No WebSocket/SSE anywhere. Live vehicle
  tracking or terminal liveness will eventually want one; nothing today does.
  Defer; just don't architect new manager views that secretly assume polling
  is forever.
- **D3 — The cut features come back.** Barcode check-in, face recognition, and
  WhatsApp were cut *for this client*, not from the product. All three land on
  seams named in this review: barcode → mostly mobile-side (see §5), face →
  C2/C3 + biometric-data compliance (§6), WhatsApp → D1.

## 5. "Hardware integration" is several different projects — scope it before building

The single most useful product decision available now: name the first device,
because the integration shapes differ by an order of magnitude:

| Device | Integration shape | Backend work |
| --- | --- | --- |
| Barcode/QR scanner | Phone camera or BT keyboard-wedge → it's a mobile *feature* | ~none |
| Receipt printer | Bluetooth ESC/POS from the technician app | ~none (bill data exists) |
| Attendance terminal | Autonomous device → backend ingestion | C1+C2+C3, the full track |
| Vehicle GPS tracker | Vendor cloud → inbound webhook | C1 (service principal) + D1 |
| Payment terminal / PSP | Compliance-heavy third-party integration | Own project; ledger is ready |

The expensive principal/registry/event work is triggered **only by autonomous
devices**. If the first hardware is a scanner or printer, it ships as an app
feature with zero backend change — don't build the device platform for it.

## 6. Product-operations gaps (the business of selling this)

- **F1 — One environment, deployed from a laptop.** No staging (mobile
  `config.ts` documents a "staging API" for preview builds that does not
  exist); Railway not GitHub-connected. A product needs dev/staging/prod and
  CI-driven deploys with provenance. (Carried over from the production review,
  upgraded from "weak" to "blocking" by the product scope.)
- **F2 — Backup/DR remains the #1 disqualifier, now contractual.** Holding
  *other companies'* cash ledgers with no backups isn't a gap, it's a liability.
- **F3 — Distribution.** One Play Store app + tenant resolution at login (shop
  code → backend/config), OTA updates (`expo-updates`), staged rollouts, and a
  min-client-version gate in the API. Hand-installed APKs with build-time-baked
  URLs cannot onboard a customer you don't visit.
- **F4 — Tenant lifecycle.** No provisioning path (create shop, seed manager,
  set PINs, configure geofence) beyond manual SQL + seeds. Needs to be a
  runbook first, an admin surface later.
- **F5 — Compliance posture: undefined.** Customer PII (names, phones,
  addresses), employee location + selfies, evidence video retention, per-tenant
  export/delete — none have a stated policy. Face recognition or fingerprint
  hardware adds biometric-data law on top (consent, template storage). Write
  the data-retention policy before the second customer asks for it.
- **F6 — Per-tenant observability.** Sentry exists (backend + mobile, no web);
  events carry no tenant tag. Trivial to add once `shop` is in the JWT (B2).

## 7. What already carries over (do not rebuild)

Credit where due — these survive the reframe untouched and are the reason the
product track is an *extension*, not a rewrite:

- **`client_id` idempotency on every money/punch write** — THE hardware-grade
  property. Flaky devices retransmit; the API already absorbs replays.
- **Offline outbox semantics, drift detection, flag-never-block evidence** —
  the philosophically hard parts of field-device ingestion, already solved.
- **Signed-URL media** — any device that can HTTPS PUT can deliver evidence;
  credentials never leave the backend.
- **Integer minor-unit money, append-only ledger, per-job rate snapshots,
  atomic claim/transition guards** — the billing core is product-grade.
- **Slice architecture with CI-enforced contracts** — `devices`, `inventory`,
  `tenants` drop in as new slices without touching existing ones.
- **Pure policy modules with injected clocks** — per-tenant policy
  parameterization slots into existing seams.

## 8. The compiled sequence

**P0 — unchanged, first, no exceptions:** the five production items from
`REMEDIATION-PLAN.md` wrap-up (APK rollout → Phase 4 deploy, backups + restore
drill, PIN rotation, CI-driven deploys, web Sentry/uptime). This workshop is
customer #1; product ambition doesn't excuse losing their data.

**P1 — "stop digging" rules, adopted now, applied in the normal course of
work (days, not weeks):**
1. Introduce `/api/v1`; alias `/api` for the existing fleet; new consumers use
   versioned paths only (A1).
2. Plan the `*_paisa` → `*_minor` + tenant `currency` rename into that same v1
   cut (A2).
3. Add `shop_id` to `technician`, put `shop` in JWT claims; stamp `job_media` /
   `device_token` opportunistically (B1–B3).
4. New business config → `shop_settings` table, never env; migrate the two
   rates first (B4).
5. Keep writing `job_event` rows for every state change; add structured
   payloads when convenient (D1 groundwork).
6. Fix stale comments that misdescribe the security model
   (`identity/models.py` still says "no per-role gating").

**P2 — triggered by a signed second customer, not before:** tenant resolution
at login, scheduler fan-out per shop, provisioning runbook, isolation ADR
(repo-scoping audit vs RLS), Play Store + OTA + min-client-version, real
staging environment, retention policy (B5, B6, F3–F5).

**P3 — triggered by the first autonomous-device purchase order, not before:**
device principals + API keys, device registry (consider pulling this into P1 —
it pays for itself on the mobile fleet today), generalized punch evidence
(source discriminator, nullable selfie, JSONB evidence), transactional outbox →
webhook dispatcher (C1–C3, D1).

**The anti-roadmap (explicitly rejected):** microservices, Kafka/queues,
Kubernetes, GraphQL, a generic "IoT platform" before the first device,
multi-region. The monolith on Railway + Postgres carries this product to
dozens of tenants. Every item above is a seam or a column, not a new system.
