# FixFlow — Consolidated Roadmap (2026-06-11)

> The single ordered to-do list, compiled from four reviews: production readiness
> (REMEDIATION-PLAN.md — phases 0–5 done, Phase 4 deploy gated), the 50–100-tech
> scale assessment, the product-scope review (PRODUCT-READINESS-REVIEW.md), and
> the serverless evaluation. This document **supersedes the sequencing** in all
> of those; the originals keep the reasoning.
>
> Ordering is load-bearing, same rule as always: a track's position encodes a
> dependency or a risk, written down so it isn't "optimized" away later.

---

## How to read this

- **Tracks A–C** make the current system production-grade for customer #1.
  Nothing else matters until these are done — A unblocks the worst deployed
  bug, B protects the money record, C closes the open door.
- **Tracks D–F** are the near-term engineering queue: pipeline, contract
  hardening, mobile robustness. Each item is PR-sized.
- **P2/P3** are trigger-gated product phases. Starting them early is waste;
  starting them late is fine.
- **Decisions** is the owner's queue — each one blocks a named item.

Effort labels: `S` = hours, `M` = a day or two, `L` = several days.

---

## Track A — Ship what's built (the gate) · NOW

The fleet still runs the v1 outbox (silent cash-loss on non-network errors).
Everything that fixes it is merged or on this branch; the remaining work is
operational. **A2 strictly after A1** — deploying money guards against old
clients manufactures the exact loss they prevent.

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| A1 | Merge PR #67 (jobs read cache) → cut APK → **install on every phone** → record which device runs which build | M (mostly legwork) | The open gate since Phase 3 |
| A2 | Deploy Phase 4 backend (money guards, `wait` transition) | S | Only after A1 confirms full fleet coverage |
| A3 | Post-deploy verify: close flow 409→complete→close on a real device, Put-on-Hold on web | S | The #62 CI lesson: exercise via HTTP, not unit paths |

## Track B — Don't lose the data · NOW (independent of A — start same day)

The cash ledger, payroll, and attendance evidence live in one Postgres with no
backups. Most disqualifying gap in every review; product scope makes it
contractual.

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| B1 | Backups: Supabase Pro (daily + PITR) **or** nightly `pg_dump` → R2 via scheduled job | M | Decide by money: Pro is the lazy-correct answer |
| B2 | **Run one restore drill** into a scratch DB; write the runbook | M | A backup never restored is a hope |
| B3 | R2: enable bucket versioning; retention policy waits on Decision 2 | S | |

## Track C — Lock the doors · NOW (half a day, owner-driven)

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| C1 | Rotate every PIN (manager 6+, techs 4+), via the existing set-PIN endpoint | S | Tooling exists since Phase 1; this is purely doing it |
| C2 | Scrub `1234` and live credentials from HANDOFF.md and any doc | S | Docs are in the repo; the repo URL is in the docs |

## Track D — Pipeline & visibility · NEXT (after A–C, ~2–3 days total)

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| D1 | CI-driven deploys: GitHub Action runs `railway up` on main, records the SHA | M | Ends laptop-deploy drift; keeps Railway |
| D2 | Web SPA → static host (Cloudflare Pages): atomic deploys from CI | M | Kills the stale-bundle cache gotcha **and** the web container; update `FIXFLOW_CORS_ORIGINS` |
| D3 | Web Sentry + an uptime ping on `/api/health` | S | Backend+mobile have Sentry; the manager's daily tool is blind |
| D4 | Dependabot (npm ×2 + pip) | S | expo-av migration lands with SDK 53 anyway |

## Track E — Contract hardening · NEXT (interleave with D; each PR-sized)

The "stop digging" set: every week of delay adds consumers to contracts that
will have to break. **E1 before any new external consumer exists.**

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| E1 | `/api/v1` prefix; keep `/api` as alias for the installed fleet; new consumers use v1 only | M | Cheapest it will ever be: the fleet is 5 phones |
| E2 | `shop_id` on `technician` (migration) + `shop` claim in JWT; stamp `job_media`/`device_token` opportunistically | M | Tenancy starts at identity; attendance/jobs already carry it |
| E3 | `shop_settings` table; move `labour_rate_paisa` + `fuel_rate_paisa_per_km` out of env | M | Per-job rate snapshot already protects history |
| E4 | `*_paisa` → `*_minor` + tenant `currency` — **rides the E1 version cut**, not a separate break | M | Urgency set by Decision 4 |
| E5 | `next_token` → Postgres sequence | S | Race goes from theoretical to weekly at product volume |
| E6 | Doc truth pass: ARCHITECTURE.md frontend section (still describes mock/no-auth web), `identity/models.py` role comment, mobile `config.ts` staging reference | S | Doc drift misleads the next engineer within the hour |

## Track F — Mobile robustness & fleet control · rides the next APK cycles

Batch into as few APK cuts as possible (the standing constraint). F1+F2 ride
the first post-v13 cut; F3 is the strategic one.

| # | Item | Effort | Notes |
| --- | --- | --- | --- |
| F1 | Voice-note offline: stop the silent drop — queue the audio or warn before submitting without it | M | Known evidence loss in CompleteJobScreen |
| F2 | Timeout on `FileSystem.uploadAsync` PUTs | S | A hung selfie PUT wedges the sync pass |
| F3 | **OTA updates** (`expo-updates`) + min-client-version gate in the API | L | Ends the hand-install era; prerequisite for P2 onboarding and for every future gate-style deploy; consider a minimal device registry here (app version, last-seen) — it also serves P3 |
| F4 | Unify attendance queue onto outbox v2 | M | Deferred-OK; do when next touching attendance sync |

## Decisions — the owner's queue (each blocks a named item)

| # | Decision | Blocks |
| --- | --- | --- |
| 1 | Offline punch time: trust `device_time` (tamperable) vs `server_time` (false late/tamper flags after offline sync) | Attendance correctness; worse at scale |
| 2 | Evidence-video retention period (and who may delete) | B3 policy, storage cost model |
| 3 | **First hardware device, by name** | Whether P3 exists or it's a mobile feature (scanner/printer ≈ zero backend) |
| 4 | Multi-currency timeline (Pakistan-only how long?) | E4 urgency |
| 5 | Payroll cycle flexibility per future tenant | P2 scheduler fan-out shape |

## P2 — gated on a **signed second customer**

Tenant resolution at login (shop code → config) · scheduler fan-out per shop ·
cron moved out of process (external trigger) + DB-backed IP limiter → unlocks a
second replica for availability · provisioning runbook (create shop, seed
manager, geofence, shifts) · isolation ADR (repo-scoping audit vs RLS) · Play
Store listing · real staging environment · retention policy implemented ·
per-tenant Sentry tags · identity upgrade (longer PINs / device binding) ·
basic load test before onboarding.

## P3 — gated on the **first autonomous-device purchase order**

Device/service principals + API keys (widen the role CHECK) · device registry
(or extend the F3 one) · generalized punch evidence (`source` discriminator,
nullable selfie, JSONB evidence) · `job_event` → structured payload + global
sequence → transactional outbox → webhook dispatcher (also unlocks WhatsApp +
ERP push, regardless of hardware).

## Anti-roadmap (standing, explicitly rejected)

Microservices · FaaS-ifying the API · Kafka/queues · Kubernetes · GraphQL ·
generic IoT platform before the first device · multi-region · changing the
database. The monolith on Railway + Postgres carries this product to dozens of
tenants; every accepted item above is a seam or a column, not a new system.

---

## The shape of it

```
NOW        A (ship the gate)  B (backups)  C (PINs)        ← parallel, ~1 week elapsed
NEXT       D (pipeline/visibility) ⇄ E (contract hardening) ← ~2 weeks part-time
APK CYCLE  F1 F2 → F3 (OTA + registry)
GATED      P2 (second customer)   P3 (first autonomous device)
ALWAYS     Decisions 1–5 unblock items above; anti-roadmap stays rejected
```
