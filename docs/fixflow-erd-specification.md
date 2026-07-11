# FixFlow Target Data Model — v1.0

**Scope:** the production target schema evolving the live database (Alembic head **0017**, 15 tables) into the data-asset architecture the July 2026 strategy review requires (§4 gaps, §5 telemetry, §6 human factors) plus the workflow realities from the original brainstorming (transport legs, approval artifacts, serial-at-arrival, intake channels).

**Companion file:** `fixflow-target-erd.mermaid` — the diagram. Solid edges are enforced FKs; the single dashed edge is the one deliberately loose reference that remains.

**Result:** 15 existing tables (9 modified, 6 untouched) + 20 new tables = **35 tables**. Nothing is dropped; nothing breaks a running client; every step is reachable by additive migration.

---

## 1. Conventions (inherited and new)

The house rules from 0001–0017 are kept; four new conventions are added. All future migrations should conform.

| # | Convention | Rule |
|---|---|---|
| C1 | Primary keys | UUID `gen_random_uuid()` for **open-world** entities (rows created by operations: customers, units, models, parts, events). **String slug PKs** for **curated vocabularies** humans read in queries and analytics (`technician`, `shop`, `appliance_category`, `fault_code`, `action_code`). Slugs make the reliability index legible (`ac / ac_no_cooling / gas_recharge`); UUIDs keep growing sets merge-safe. |
| C2 | Enums | `String` + named `CheckConstraint`, exactly as today. Adding a value = one CHECK migration. No native PG enums. |
| C3 | Money | `BigInteger` minor units. Existing `*_paisa` columns keep their names (no churn on a live ledger). **New** money columns are named `*_minor`; the unit is defined by `shop.currency` (seed `PKR` ⇒ paisa). This quarantines the "PKR-named fields" debt instead of deepening it. |
| C4 | Time | `DateTime(timezone=True)`, server `now()` default. Server time is authoritative; device time recorded alongside where the write originates offline. |
| C5 | Offline idempotency | Any row that can originate on the phone carries `client_id UUID UNIQUE`. Applies to new tables: `app_event`. (`job_outcome` is manager/system-originated — no client_id.) |
| C6 | Tenancy | `shop_id String(64) NOT NULL DEFAULT 'default'` on every tenant-scoped table, FK → `shop.id`. The diagram draws only four anchor edges to stay readable; the FK exists everywhere. |
| C7 | **Raw + resolved** *(new)* | Normalization never destroys the human's input. Free-text stays in a `*_raw` column; the resolved FK sits beside it (`job_material.name_raw` + `part_id`; `appliance_unit.brand_raw/model_raw` + `model_id`). Resolution can be re-run; the raw corpus trains future matchers. |
| C8 | **Snapshot + FK** *(new)* | `job.customer_name/phone/address` are **not legacy cruft** — they are the immutable intake snapshot (what was true when the job happened), kept alongside `customer_id`. Customers move and rename; jobs don't. Same logic keeps `job.appliance_brand/model` as intake-time raw capture. |
| C9 | **JSONB policy** *(new)* | Columns for what you filter/aggregate on; typed JSONB (`payload`, `props`, `attrs`) for what you record but don't yet query; free text only under C7. This is the schema's answer to "we input all sorts of stuff" — variety lands in JSONB, never in new free-text columns. |
| C10 | **Loose-ref policy** *(new)* | Loose references are allowed only when an enforced FK could block a money/evidence write under the offline model, and each one must have a named reconciliation sweep (§6). Everything else becomes a real FK in Wave 3. |
| C11 | Deletes | Transactional tables are append-only (void + re-log). Catalog tables use `active BOOLEAN` + `status` (pending_review → active) — never hard-delete a row that historical data references. |

---

## 2. Domain map

| Slice | Unchanged | Modified | New |
|---|---|---|---|
| tenancy & geo | — | — | `shop`, `area` |
| identity | — | `technician` (+shop FK) | — |
| customer | — | — | `customer`, `customer_phone`, `customer_consent_event` |
| asset | — | — | `appliance_unit` |
| catalog & taxonomy | — | — | `appliance_category`, `appliance_brand`, `appliance_model`, `brand_alias`, `model_alias`, `fault_code`, `action_code`, `part`, `part_alias` |
| jobs | `job_payment` | `job`, `job_event`, `job_completion`, `job_material`, `job_location` | `job_outcome`, `job_travel_sample` (0035) |
| media | — | `job_media` (type fix + FK + phases) | — |
| notifications/fleet | — | `device_token` (+FKs) | `device` |
| attendance & payroll | `attendance_shift`, `attendance_geofence`, `attendance_adjustment`*, `payroll_export` | `attendance_event`, `attendance_presence_event` (+tech FK) | — |
| telemetry & dispatch | — | — | `app_event`, `ops_metric_rollup`, `dispatch_cursor` |

\* `attendance_adjustment.manager_id` gains an FK in Wave 3 with the other tech-ref fixes.

---

## 3. New entities — data dictionary

### 3.1 Tenancy & geography

**`shop`** — the tenant root. Seeded with the `'default'` row so every existing `shop_id` value validates immediately.

| Column | Type | Constraints / notes |
|---|---|---|
| id | String(64) PK | `'default'` seeded; future shops get slugs |
| name | String(128) NOT NULL | |
| address | String(512) | |
| timezone | String(64) NOT NULL DEFAULT 'Asia/Karachi' | replaces the per-shift assumption over time |
| currency | String(3) NOT NULL DEFAULT 'PKR' | defines the unit of all `*_minor` columns (C3) |
| whatsapp_number | String(32) | the §5.3 dispatcher's sending identity |
| active | Boolean DEFAULT true | |
| created_at | timestamptz now() | |

**`area`** — city localities; the geography axis of the reliability index and the §4.6 power-quality picker. Global (no shop_id): areas outlive any one shop and must aggregate across tenants.

| Column | Type | Constraints / notes |
|---|---|---|
| id | UUID PK | |
| city | String(64) NOT NULL | 'Karachi' seeded |
| name | String(128) NOT NULL | Gulshan, DHA, Saddar… `UNIQUE(city, name)` |
| name_ur | String(128) | |
| power_quality | String(16) DEFAULT 'unknown' | CHECK `good/moderate/poor/unknown` — manager-set, revisable |
| lat, lng | Float | centroid, optional |
| active | Boolean DEFAULT true | |

### 3.2 Customer & consent (§4.1, §5.4)

**`customer`** — the identity that turns job logs into repeat-customer graphs and LTV.

| Column | Type | Constraints / notes |
|---|---|---|
| id | UUID PK | |
| shop_id | String(64) FK shop NOT NULL | |
| full_name | String(128) NOT NULL | |
| area_id | UUID FK area, nullable | |
| address_default | String(512) | current address; job keeps its own snapshot (C8) |
| source | String(16) DEFAULT 'walk_in' | CHECK `walk_in/whatsapp/phone/online_form/email/referral/backfill` |
| whatsapp_opt_in_at | timestamptz nullable | denormalized current state; truth in consent log |
| consent_contact_at | timestamptz nullable | " |
| merged_into_customer_id | UUID FK customer, nullable | dedupe merges point loser → winner; reads follow the pointer; no row deletion |
| notes | String(1024) | |
| created_at / updated_at | timestamptz | |

Indexes: `(shop_id)`, `(merged_into_customer_id)`.

**`customer_phone`** — multiple SIMs are the norm; strategy says "phone(s)". E.164-normalized, this is the intake match key.

| Column | Type | Constraints / notes |
|---|---|---|
| id | UUID PK | |
| customer_id | UUID FK customer NOT NULL | |
| phone_e164 | String(20) NOT NULL | normalized `+92…`; `UNIQUE(customer_id, phone_e164)` |
| label | String(32) | 'primary', 'whatsapp', 'spouse'… |
| is_primary | Boolean DEFAULT false | |

Index: `(phone_e164)` — **not** globally unique: households share numbers; matching is a ranked suggestion, never an auto-merge.

**`customer_consent_event`** — append-only consent log. Cheap now, decisive when the PDP Bill lands: current-state columns on `customer` answer "may we?", this table answers "prove it."

| Column | Type | Constraints / notes |
|---|---|---|
| id | UUID PK | |
| customer_id | UUID FK NOT NULL | |
| kind | String(16) NOT NULL | CHECK `given/withdrawn` |
| scope | String(16) NOT NULL | CHECK `contact/whatsapp/analytics` |
| channel | String(16) NOT NULL | CHECK `verbal/form/whatsapp/backfill` |
| recorded_by | String(64) | tech/manager slug |
| created_at | timestamptz now() | |

### 3.3 The asset layer — `appliance_unit` *(the one entity the review implies but never names)*

The review's outcome loop (§4.5) wants to "link a January fridge repair to its March re-failure," and v0 does it by fuzzy `customer + appliance within 90 days`. That inference becomes a **fact** if the physical machine is an entity. `appliance_unit` is the row that makes reliability data per-unit rather than per-job — repairs over time on *the same compressor* is exactly what an underwriter buys. It also gives serial numbers (captured at arrival per the workflow spec), purchase year (§4.7), and unit-level attrs a home.

| Column | Type | Constraints / notes |
|---|---|---|
| id | UUID PK | |
| shop_id | String(64) FK NOT NULL | |
| customer_id | UUID FK customer NOT NULL | units move on customer merge |
| category_id | String(32) FK appliance_category NOT NULL | |
| model_id | UUID FK appliance_model, nullable | resolved when known |
| brand_raw / model_raw | String(64/64) | what was typed/said (C7) |
| serial_number | String(64) nullable | captured at arrival/drop-off; indexed, **not** unique (typos, shared plates) — dedupe is a review queue |
| purchase_year | int nullable | §4.7 warranty economics |
| attrs | JSONB DEFAULT '{}' | tonnage, capacity, unit-specific facts (C9) |
| notes | String(1024) | |
| created_at / updated_at | timestamptz | |

Indexes: `(customer_id)`, `(model_id)`, partial `(serial_number) WHERE serial_number IS NOT NULL`.

**Lifecycle rule:** a unit row is created (or matched — "same fridge as March?") at intake with whatever is known; enriched with serial at arrival. New jobs set `appliance_unit_id` NOT NULL at the app layer once Wave 1 ships; the column stays nullable in SQL for the historical rows that predate it.

### 3.4 Catalog & taxonomy (§4.2–4.4, §4.6)

**`appliance_category`** — the existing picker promoted to a table; the anchor for models, faults, actions, parts.

| Column | Type | Notes |
|---|---|---|
| id | String(32) PK | `ac`, `refrigerator`, `deep_freezer`, `washing_machine`, `water_dispenser`, `microwave`, `oven`, `tv`, `other` (seed) |
| name_en / name_ur | String(64) | tap-chip labels (§6: icon + Urdu + English) |
| icon | String(64) | |
| sort | int | |
| active | Boolean DEFAULT true | |

**`appliance_brand`**

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name_canonical | String(64) NOT NULL UNIQUE | seed: Dawlance, Haier, PEL, Orient, Waves, Samsung, Gree, Kenwood + brands mined from historical `job.appliance_brand` |
| country | String(64) nullable | |
| status | String(16) DEFAULT 'active' | CHECK `active/pending_review` — technician "add new" lands as pending; manager approves |
| active | Boolean DEFAULT true | |

**`appliance_model`**

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| brand_id | UUID FK brand NOT NULL | |
| category_id | String(32) FK category NOT NULL | |
| model_norm | String(64) NOT NULL | normalized (upper, trimmed); `UNIQUE(brand_id, model_norm)` |
| launch_year | int nullable | |
| attrs | JSONB DEFAULT '{}' | per-category specs: tonnage, cu-ft, inverter y/n (C9) |
| status | String(16) DEFAULT 'active' | CHECK `active/pending_review` |
| created_by | String(64) | |

**`brand_alias` / `model_alias` / `part_alias`** — three identical small tables (explicit FKs beat one polymorphic table for integrity). Each: `id UUID PK · alias_norm String(64) NOT NULL · <target>_id FK NOT NULL · UNIQUE(alias_norm, <target>_id)`, index on `alias_norm`. "haier", "HIER", "هائیر" all resolve; the picker consults aliases on fuzzy match; a manager approving a misspelling *creates* an alias, so the same mistake auto-resolves forever after.

**`fault_code`** — diagnosis vocabulary, per category, 8–15 codes each; `faultCodes.js` promoted as seed.

| Column | Type | Notes |
|---|---|---|
| id | String(64) PK | `ac_no_cooling`, `ref_compressor_dead` — legible in every analytics query (C1) |
| category_id | String(32) FK NOT NULL | |
| label_en / label_ur | String(128) | |
| icon | String(64) | |
| is_surge_related | Boolean DEFAULT false | §4.6 — the surge codes are just flagged members of the same vocabulary |
| sort | int | |
| active | Boolean DEFAULT true | never delete: history references it |

**`action_code`** — same shape minus `is_surge_related`: `id PK · category_id FK · label_en · label_ur · icon · sort · active`. (`ac_gas_recharge`, `ref_relay_replace`…)

**`part`** — the most monetizable stream gets a canonical identity. Prices are **not** stored here: every `job_material` row is a dated, located price observation — the price index is a query, not a column.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name_canonical | String(128) NOT NULL | `UNIQUE(name_canonical, category_id)` |
| category_id | String(32) FK, nullable | primary appliance category; NULL = cross-category (capacitors, wire) |
| quality | String(16) nullable | CHECK `genuine/aftermarket/refurb` — default expectation; per-line truth on job_material |
| source_market | String(64) nullable | default source (Saddar, Regal…) |
| status | String(16) DEFAULT 'active' | CHECK `active/pending_review` |
| active | Boolean DEFAULT true | |

### 3.5 Outcomes (§4.5)

**`job_outcome`** — the actuarial table. Multiple checks per job allowed (30-day call, 90-day auto-scan), hence no unique on job_id.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| job_id | UUID FK job NOT NULL | the repair being verified |
| checked_at | timestamptz NOT NULL | |
| channel | String(16) NOT NULL | CHECK `auto_link/manager_call/whatsapp` |
| result | String(16) NOT NULL | CHECK `ok/re_failed/unreachable/pending` |
| refail_fault_code_id | String(64) FK fault_code, nullable | when reported without a new job yet |
| refail_job_id | UUID FK job, nullable | **the strongest signal**: the follow-up job itself, when it exists — links the January fridge to its March re-failure as a row, not an inference |
| notes | String(512) | |
| recorded_by | String(64) | tech/manager slug or `'system'` |
| created_at | timestamptz now() | |

Index: `(job_id, checked_at)`. v0 writer: a scheduled scan creating `channel='auto_link'` rows for repeat jobs on the same `appliance_unit_id` within 90 days, plus the manager's weekly call list (a query: closed 7–90 days ago, no outcome row).

### 3.6 Fleet & telemetry (§5.1–5.2)

**`device`** — the fleet registry (review items C3/F3): rollout gate, hardware onboarding anchor, per-device telemetry key.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| installation_id | String(64) NOT NULL UNIQUE | Expo installation id |
| tech_id | String(64) FK technician, nullable | bound at first login |
| platform | String(16) DEFAULT 'android' | |
| os_version / app_version | String(32) | app_version drives the fleet-rollout gate |
| last_seen_at | timestamptz | heartbeat on any authenticated call |
| created_at | timestamptz now() | |

**`app_event`** — Layer-1 product analytics riding the outbox (offline-safe analytics for free). **PII rule (hard):** `props` may contain entity UUIDs and slugs only — never names, phones, addresses (§5.4; enforced by review + a CI grep on event-emit sites).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| client_id | UUID NOT NULL UNIQUE | outbox dedupe (C5) |
| shop_id | String(64) FK NOT NULL | |
| actor_kind | String(16) NOT NULL | CHECK `tech/manager/system` |
| actor_id | String(64) nullable | tech slug — employee analytics is covered by the signed staff data policy |
| name | String(64) NOT NULL | `screen_view`, `outbox_dead_letter`, `bill_negotiated`… (launch set of ~15) |
| props | JSONB DEFAULT '{}' | |
| device_id | UUID FK device, nullable | |
| device_time | timestamptz nullable | |
| server_time | timestamptz now() | |

Indexes: `(shop_id, name, server_time)`, `(server_time)`. Volume is Postgres-trivial for years; **partition by month when it crosses ~10M rows** (§7 note) — design nothing else for scale now.

**`ops_metric_rollup`** — 5-minute snapshots off the existing APScheduler so ops history survives deploys: `id PK · captured_at NOT NULL · window_seconds int DEFAULT 300 · route String(128) · method String(8) · count int · error_count int · p50_ms int · p95_ms int · p99_ms int`. Index `(captured_at)`; `route='_all'` rows carry totals.

**`dispatch_cursor`** — the two-column table that makes `job_event` a real transactional outbox (D1): `consumer String(32) PK` (`whatsapp`, `erp`, `analytics`) · `last_seq BigInteger NOT NULL DEFAULT 0` · `updated_at`. One dispatcher loop per consumer reads `job_event WHERE seq > last_seq ORDER BY seq`, delivers, advances. Delivery failures don't advance the cursor; poisoned events dead-letter by advancing with an `app_event` alarm — same philosophy as outbox v2.

---

## 4. Changes to existing tables

### 4.1 `job`
Additions (all nullable / defaulted — zero impact on running clients):

| Column | Type | Purpose |
|---|---|---|
| customer_id | UUID FK customer | identity (snapshot fields stay, per C8) |
| appliance_unit_id | UUID FK appliance_unit | the asset link; app-required for new jobs post-Wave-1 |
| category_id | String(32) FK appliance_category | backfilled by mapping `appliance_type` strings; app writes both during transition |
| area_id | UUID FK area | job-site area (defaults from customer; a job can be at a different address) — makes fault × area a direct join |
| intake_channel | String(16) CHECK `walk_in/whatsapp/phone/online_form/email` | the brainstorm's complaint channels, finally recorded |
| type_reason | String(256) | the brainstorm's "note on reason for selection" (carry-in vs home-visit vs pickup) |
| power_protection | String(16) CHECK `none/stabilizer/ups/solar_hybrid/unknown` | §4.6 |
| suspected_surge | Boolean nullable | §4.6 |
| in_warranty_claimed | Boolean nullable | §4.7 (durable purchase_year lives on the unit) |

Modified: `job_type` CHECK extended to `carry-in / home-visit / pickup-delivery` (the brainstorm's workshop-B "we transport" becomes a first-class type). `assigned_tech_id` gains FK → technician (Wave 3). New indexes: `(customer_id)`, `(appliance_unit_id)`, `(shop_id, category_id, status)`.

### 4.2 `job_event`
+ `payload JSONB DEFAULT '{}'` and + `seq BigInteger UNIQUE` from a global sequence (D1). Historical rows backfill `seq` in `created_at` order before the UNIQUE constraint applies. New kinds join the CHECK as needed (e.g. `pickup`, `deliver`); estimates and approvals keep riding events (`kind='estimate'/'approved'` + payload) — no new tables for them, the artifact is the event plus its media.

### 4.3 `job_completion`
+ `fault_code_id String(64) FK fault_code, nullable` and + `action_code_id String(64) FK action_code, nullable` — the two tap-pickers (§4.3). Nullable forever: **flag-never-block extends to data completeness**; the completeness score (§6), not a constraint, drives fill-rate. One primary fault + one primary action for v1; a `job_completion_fault` M2M is a future migration if multi-diagnosis proves real. `remarks_audio_media_id` **stays loose** (§6 below).

0035 adds fuel provenance: `fuel_basis` ('manual' | 'estimate' | 'breadcrumbs'; NULL on historical rows reads as implicitly manual), `fuel_distance_m` (the billed round-trip metres when derived), and a NOT NULL `fuel_rate_paisa_per_km` snapshot pinned at first submission — the same never-silently-repriced contract as `labour_rate_paisa`.

### 4.4 `job_material`
+ `part_id UUID FK part, nullable` · rename `name` → `name_raw` (C7; SQLAlchemy attribute keeps `name` for wire compat) · + `quality String(16) CHECK genuine/aftermarket/refurb, nullable` · + `source_market String(64) nullable`. The picker that writes `part_id` also prices the line — the §6 money-gate is what makes this table fill itself.

### 4.5 `job_location`
`kind` CHECK extended: `depart_workshop / arrive_customer / depart_customer / arrive_workshop / depart_workshop_delivery / arrive_customer_delivery` — pickup-delivery transport legs reuse the existing GPS-punch rail instead of a new table.

### 4.6 `job_media`
The known integrity gap fixed: `job_id` **String(64) → UUID + FK → job.id** (backfill cast; any non-casting orphans land in a quarantine table for manual review — expected count ≈ 0). `phase` CHECK extended: `before / after / remark / closing / condition / approval` (pickup/drop-off condition photos; quote-photo or voice-consent artifacts). Optional: `duration_seconds int` for audio/video — cheap corpus metadata.

### 4.7 `technician` / `device_token` / attendance tables
`technician` + `shop_id FK` (backfill `'default'`), + `language_pref String(8) DEFAULT 'ur'` (drives the Urdu pass). `device_token` + `device_id UUID FK device, nullable`; `tech_id` gains FK. `attendance_event`, `attendance_presence_event`, `attendance_shift`, `attendance_adjustment.manager_id`: `tech_id`/manager refs gain FKs → technician (Wave 3; roster rows always precede references, so validation is safe).

### 4.8 Untouched
`job_payment`, `attendance_geofence`, `payroll_export` — correct as built. (`attendance_shift` changes only by the FK above.)

---

## 5. PII & pseudonymization map (§5.4)

| Zone | Tables | Rule |
|---|---|---|
| **PII zone** | `customer`, `customer_phone`, `customer_consent_event`, `job` (snapshot cols), `attendance_event` (selfie path), `job_media` (customer-visible media) | Export/delete tooling targets this zone only. Backups obviously include it. |
| **Pseudonymous zone** | `app_event`, `ops_metric_rollup`, `job_outcome`, all catalog/taxonomy, `job_event.payload` | Entity UUIDs + slugs only. No names/phones/addresses — reviewed at PR + CI grep on emit sites. |
| **External sharing** | none of the above directly | Aggregates only, k ≥ 20 suppression, per the review. The schema supports this; policy enforces it. |

A "delete customer" operation = anonymize `customer` row + phones + job snapshot columns for that customer_id; UUIDs and all operational/aggregate rows survive intact. Single-zone concern by design.

---

## 6. Integrity register

**Enforced FKs after Wave 3** — everything drawn solid in the diagram, including the seven that exist today plus: all `shop_id` → shop; `job.customer_id / appliance_unit_id / category_id / area_id / assigned_tech_id`; `job_media.job_id`; `job_completion.fault_code_id / action_code_id`; `job_material.part_id`; `job_outcome.*`; all catalog FKs; `device.tech_id`; `device_token.tech_id / device_id`; attendance `tech_id`s; `customer.*`; `appliance_unit.*`.

**Deliberately loose (C10) — exactly one survives:**

| Ref | Why loose | Reconciliation |
|---|---|---|
| `job_completion.remarks_audio_media_id` → job_media | The completion form is the money path; its outbox item must never be rejected because the voice-note's media-create item dead-lettered. An FK here would block billing on evidence — inverted priorities. | Nightly integrity sweep: completions whose audio id resolves to nothing older than 48h → `app_event('media_orphan')` + manager dashboard flag. |

**FK rollout pattern (production requirement):** every FK added to a populated table ships as `NOT VALID`, backfill/repair runs, then `VALIDATE CONSTRAINT` in a follow-up migration — no long ACCESS EXCLUSIVE locks on live tables, and orphans surface as a worklist instead of a failed deploy.

---

## 7. Index & partition plan (beyond per-table notes above)

Hot paths: intake match (`customer_phone(phone_e164)`), board queries (`job(shop_id, status)` exists; add `(shop_id, category_id, status)`), unit history (`job(appliance_unit_id)`), outcome scan (`job_outcome(job_id, checked_at)`), dispatcher (`job_event(seq)` via UNIQUE), analytics (`app_event(shop_id, name, server_time)`).

Partitioning: **none now.** `app_event` and `job_event` become monthly range partitions only past ~10M rows; the schema requires no change to adopt it later (both are insert-only with time columns). Resist warehouse infrastructure until a query proves Postgres can't — per the review's anti-roadmap.

---

## 8. Seed data (ships with Wave 1 migrations)

1. `shop`: the `'default'` row (name/timezone/currency).
2. `appliance_category`: the nine slugs in §3.4 with EN/UR labels + icons.
3. `appliance_brand`: the eight market leaders + distinct values mined from historical `job.appliance_brand` (normalized, misspellings → `brand_alias`).
4. `fault_code` / `action_code`: `faultCodes.js` promoted — its appliance/symptom/recommended-part rows map to fault codes, action codes, and initial `part` rows; add the surge-flagged codes.
5. `area`: ~15–25 Karachi localities mined from historical `customer_address` strings, `power_quality='unknown'` until the manager sets it.
6. `customer` backfill: cluster historical jobs by normalized phone → customer rows (`source='backfill'`), attach `customer_id`; ambiguous clusters stay unlinked for manual merge (that's what `merged_into_customer_id` is for).
7. `appliance_unit` backfill: one unit per (customer × category × brand/model-raw) cluster from history; conservative — under-merge, never over-merge.

---

## 9. Migration sequence from head 0017

Granular, additive, each independently deployable; nothing blocks a workflow mid-sequence. Wave 0 (backups + restore drill, credential scrub, PIN rotation, fleet APK) precedes everything, unchanged.

| # | Migration | Contents | Strategy map |
|---|---|---|---|
| 0018 | tenancy root | `shop` + seed + `shop_id` FKs (NOT VALID→VALIDATE) + `technician.shop_id` | pre-req |
| 0019 | customer | `customer`, `customer_phone`, `customer_consent_event`, `job.customer_id`, phone-cluster backfill | 0018 (§9 W1) |
| 0020 | geography | `area` + seed, `customer.area_id`, `job.area_id` | §4.6 slice |
| 0021 | catalog | `appliance_category` + seed + `job.category_id` backfill; `appliance_brand`, `appliance_model`, `brand_alias`, `model_alias` + brand mining | 0019 (W1) |
| 0022 | asset | `appliance_unit` + backfill, `job.appliance_unit_id` | new (gap the review implies) |
| 0023 | taxonomy | `fault_code`, `action_code` + faultCodes.js promotion; `job_completion.fault_code_id/action_code_id` | 0020 (W1) |
| 0024 | parts | `part`, `part_alias`; `job_material.part_id/quality/source_market`, `name→name_raw` | 0021 (W1) |
| 0025 | events-as-outbox | `job_event.payload/seq` + seq backfill; `dispatch_cursor` | 0026/D1 (W2) |
| 0026 | outcomes | `job_outcome` + auto-link scan job | 0024 (W2) |
| 0027 | power & warranty & intake | `job.power_protection/suspected_surge/in_warranty_claimed/intake_channel/type_reason`; `appliance_unit.purchase_year` already in 0022; surge fault codes; `job_type` + `job_location.kind` CHECK extensions | 0025 (W2) |
| 0028 | fleet | `device`; `device_token.device_id` | §5.2 |
| 0029 | telemetry | `app_event`, `ops_metric_rollup` + rollup cron | 0022/0023 (W1) |
| 0030 | integrity wave | `job_media.job_id` String→UUID+FK (+quarantine), tech_id FKs across jobs/attendance/notifications, `job_media.phase` extension | debt paydown |
| 0035 | travel telemetry | `job_travel_sample` (GPS breadcrumbs, attendance-ping pattern on the jobs slice); `job_completion.fuel_basis/fuel_distance_m/fuel_rate_paisa_per_km` | fuel overhaul (post-plan; 0031–0034 shipped in between — see git) |

Standing rules restated: every model change ships with its migration and passes `alembic check`; no workflow blocks on a new field; PII never enters the pseudonymous zone.

**The quarter's KPI reads directly off this schema:** `% of closed jobs where category_id, model_id (via unit), fault_code_id, ≥1 job_material.part_id, and a job_outcome row are all present` — target ≥ 60% by day 90.

---

## 10. Deliberately excluded (documented so they aren't accidental)

| Not modeled | Why |
|---|---|
| Inventory / stock levels | `part` is a catalog, not a stockroom. Inventory is a different product with counting discipline the shop doesn't have; price observations don't need it. |
| Estimate & approval tables | Already served by `job_event` (kinds `estimate/approved/declined` + payload + `phase='approval'` media). A table adds nothing but joins. |
| `technician_skill` graph | H3. Derivable later from completions × outcomes × attendance — capture feeds it already. |
| Multi-fault M2M on completion | One primary fault/action first; add the M2M only if real jobs demand it (YAGNI with a named revisit trigger). |
| Two-way WhatsApp conversation state | Superseded in part (0034): `customer_message` now records the *automated Cloud API* sends — one row per (job, kind), the unique constraint doubling as the replay guard, webhook statuses folded in by `wamid`. Still excluded: inbound conversation threading — a customer reply is counted, never acted on. |
| Native PG enums, RLS, partitions, warehouse | House conventions + anti-roadmap. RLS becomes attractive at real multi-tenancy; the shop FKs laid here are its prerequisite. |

---

## 11. Open decisions (genuinely open — everything else above is a recommendation, not a question)

1. **`job.customer_id` hard requirement date** — app-enforced from Wave 1 for new jobs; when (if ever) to add SQL `NOT NULL` given backfill ambiguity? Recommend: never; app + completeness score suffice.
2. **Unit matching UX** — at intake, matching an existing `appliance_unit` needs a one-tap "same fridge as last time?" prompt; product call on how aggressive the suggestion is.
3. **`area` granularity** — locality list vs. free-typed + normalize-later. Recommend curated list (~20) with `other`; areas are the k-anonymity dimension, so fewer/larger is safer.
4. **`app_event` launch set** — the review's ~15 names are right; freeze the list in code review so event-name sprawl doesn't start.
5. **Alias normalization function** — lower/trim/strip-diacritics minimum; decide whether Urdu-script aliases normalize through transliteration or exact-match only.
