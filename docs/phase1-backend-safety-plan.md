# Phase 1 — Backend safety (implementation plan)

> Detailed plan for Phase 1 of [`REMEDIATION-PLAN.md`](./REMEDIATION-PLAN.md).
> Everything here is **backward compatible with the installed clients** (current
> web bundle + current APK) — that is the phase's contract; every design decision
> below was checked against it.

---

## PR structure (three PRs, merge in order)

| PR | Branch | Scope | Migration |
|---|---|---|---|
| **1a** | `feat/identity-hardening` | login throttle + lockout · `token_version` + revoke endpoint · set-PIN endpoint · prod boot guard | `0013` (3 columns on `technician`) |
| **1b** | `fix/jobs-integrity` | claim 409 guard · `log_payment` IntegrityError recovery · `next_token` retry | none |
| **1c** | `feat/backend-ops` | FCM prune on 404/410 · Sentry · request-ID middleware | none |

Why three: different slices, independently revertable, each reviewable in one
sitting. 1b and 1c both touch `jobs/router.py` (one line each) — merge 1b first,
rebase 1c. Deploy **once** after all three merge (single `railway up`).

---

## PR-1a — Identity hardening

### Migration `0013_technician_security.py`
Three additive columns on `technician` (additive ⇒ the previous image keeps
running against the new schema ⇒ Railway rollback stays safe):

```
failed_attempts  INTEGER      NOT NULL  server_default '0'
locked_until     TIMESTAMPTZ  NULL
token_version    INTEGER      NOT NULL  server_default '0'
```

Mirror in `identity/models.py`. No registry change (model already registered).

### 1. Login throttle + lockout (`identity/service.py`, `router.py`, new `identity/throttle.py`)

**State lives in the DB** (not memory): survives restarts, visible to support,
and there's exactly one replica so no coordination problem.

Policy (in `service.login`):
- Unknown id / inactive → generic 401 exactly as today (roster is public, but
  don't add a *new* oracle).
- If `locked_until` is in the future → raise `AccountLockedError(retry_after_s)`
  → router returns **429** with a `Retry-After` header.
- Wrong PIN → `failed_attempts += 1`; from the 5th consecutive failure:
  `locked_until = now + min(30s × 2^(n−5), 15 min)`.
- Success → reset `failed_attempts = 0`, `locked_until = NULL`, mint token.

**The cap is the design, not a tuning knob.** There is one manager account; a
hard lock means a malicious technician (or a typo-prone owner) can brick the
console. 15 minutes max, always self-healing. Escalation persists because
`failed_attempts` only resets on success.

**Commit trap (the one that silently no-ops this feature):** the identity
router commits nothing today. The failure path must `await session.commit()`
**before** raising the 401/429 — otherwise the counter write rolls back with
the request. Router shape:

```python
try:
    resp = await service.login(...)
except AccountLockedError as e:
    await session.commit()           # persist nothing-changed state is fine
    raise HTTPException(429, ..., headers={"Retry-After": str(e.retry_after)})
except InvalidCredentialsError:
    await session.commit()           # persist the bumped counter
    raise HTTPException(401, "invalid tech id or PIN")
await session.commit()               # persist the reset
return resp
```

Per-IP limiter (`identity/throttle.py`): in-memory sliding window, ~20 login
attempts/min/IP → 429. Client IP = first hop of `X-Forwarded-For` (Railway
fronts the app), falling back to `request.client.host`. In-memory is correct
here: single replica (documented), and the DB lockout is the real defense —
the IP limiter only blunts roster-wide spraying.

### 2. `token_version` + revoke endpoint

- `create_access_token` gains a `ver` claim (`security.py`).
- `get_current_principal` (`deps.py`) gains a DB check: load the technician by
  `sub`; reject 401 if the row is missing, `active` is false, or
  `claims.get("ver", 0) != tech.token_version`.
  - **Missing claim defaults to 0 and every row starts at 0** ⇒ all currently
    issued tokens stay valid. Nobody gets logged out by the deploy.
  - FastAPI's per-request dependency cache means `get_session` here reuses the
    request's session — this adds one indexed PK read per authed request on a
    6-row table. Negligible, and it *also* fixes two latent holes: deleted and
    deactivated technicians' tokens currently keep working for 30 days.
- `POST /api/technicians/{tech_id}/revoke-sessions` (gated `CurrentManager`)
  → `token_version += 1` → 204. The lost-phone kill switch.

**⚠ Revoke interacts with the OLD mobile outbox.** On 401 the installed APK
clears the token and the next `flushOutbox` run *drops queued writes* (the
Phase 3 bug). So until the Phase 3 APK is rolled out, `revoke-sessions` is for
**lost/stolen phones only** — where the queue is forfeit anyway. Do not use it
casually on an active technician. (This is why the endpoint exists now but the
runbook restricts it.)

### 3. Set-PIN endpoint

`PUT /api/technicians/{tech_id}/pin`, body `{ "pin": "…" }`:
- AuthZ: caller is a manager, **or** `principal.tech_id == tech_id`.
- Validation: digits only; min 4 for techs, **min 6 when the target is a
  manager** (that account reaches payroll + PII + the ledger).
- Effect: `pin_hash = hash_pin(pin)`; reset `failed_attempts`/`locked_until`.
  Returns 204.

**Deliberately does NOT bump `token_version`.** If PIN-change revoked sessions,
then rotating a technician's PIN would 401 their phone and the old outbox would
destroy their queued offline writes — the same trap as revoke. Decoupling means:
PIN rotation is safe to do immediately after deploy (existing sessions continue;
new logins need the new PIN); session-killing stays an explicit, separate act.
Revisit (optionally bump on PIN change) after Phase 3 is on every phone.

### 4. Production boot guard (`core/config.py`, `main.py`)

- New setting `environment: str = "dev"` (`FIXFLOW_ENVIRONMENT`).
- In `create_app()`: if (`environment == "production"` **or**
  `RAILWAY_ENVIRONMENT` is present in the env) **and** `jwt_secret` is the dev
  default → `raise RuntimeError`. The Railway auto-detect makes the guard
  fail-closed even if nobody sets the new variable.
- Boot order note: `start.sh` runs alembic *before* uvicorn, so a mis-config
  fails at uvicorn import → container exits → Railway shows crash-loop. That is
  the intended fail-safe; the migration having already run is harmless.

### Tests (1a)
- `verify_pin`/lockout policy: failure threshold, doubling, 15-min cap,
  escalation persists across an expired lock, reset on success.
- Router: counter persisted on failure (the commit trap — regression test it),
  429 carries `Retry-After`.
- `ver` matrix: missing claim + version 0 → pass; mismatch → 401; inactive →
  401; revoke bumps and old token dies (integration, real DB).
- Set-PIN authz matrix: tech→other 403, tech→self 200, manager→any 200,
  manager target with 4-digit PIN → 422; sessions survive a PIN change.

---

## PR-1b — Jobs integrity

### 1. Claim guard (service + repository + router)

Repository gains an atomic conditional claim (the row-lock makes it race-proof
— no check-then-set):

```python
async def try_claim(self, job_id: UUID, tech_id: str) -> bool:
    result = await self._session.execute(
        update(Job)
        .where(Job.id == job_id,
               Job.status != "closed",
               or_(Job.assigned_tech_id.is_(None),
                   Job.assigned_tech_id == tech_id))
        .values(assigned_tech_id=tech_id, updated_at=func.now())
    )
    return result.rowcount == 1
```

Service: claim path uses `try_claim`; on `False` → load the row and raise
`JobConflictError` with a precise message ("already assigned to …" / "job is
closed"). Router maps it to **409**. Re-claiming your own job stays an
idempotent success (offline retries must not error). The **manager `assign`
path is deliberately unchanged** — reassignment is the manager's prerogative;
only the technician free-pick is guarded.

Client compat: the installed APK shows its generic "couldn't claim" message on
409 — acceptable; the friendly message ships with the Phase 3 APK.

### 2. `log_payment` IntegrityError recovery (service)

Mirror the attendance pattern exactly (`attendance/service.py:143`): wrap the
`add_payment` flush; on `IntegrityError` → `repo.rollback()` → re-fetch by
`client_id` → if found, **skip the event append** and return `_detail` of the
re-loaded row (the rollback expired the in-memory one — re-`_load` it). Add the
missing `rollback()` helper to `JobRepository`. Concurrent duplicate now dedups
instead of 500ing.

### 3. `next_token` retry (service) — **sequence rejected, here's why**

A Postgres sequence was the original recommendation, but
`tests/conftest.py:76` creates the test schema via `Base.metadata.create_all`
— a migration-only sequence wouldn't exist on that path and `nextval()` would
break local integration runs (CI would pass; local would fail — the worst kind
of split). Keeping a metadata-attached `Sequence` in sync with a migration is
more moving parts than the problem deserves at one-manager job-creation volume.

Instead: keep `max+1`, make the *create* loop retry. In `create_job`: on
`IntegrityError` (the `uq_job_token` constraint caught a concurrent create) →
rollback → recompute token → retry, max 3 attempts, then re-raise. ~10 lines,
no schema change, unit-testable with a fake repo that raises once.

### Tests (1b)
- Claim: unassigned → success; assigned-to-other → 409; own → idempotent 200;
  closed → 409. Integration: two sessions claim the same job, exactly one wins.
- Payment: duplicate `client_id` under race → single row, single event, 200.
- Token retry: fake repo raising `IntegrityError` once → job created with the
  recomputed token; raising 3× → error surfaces.

---

## PR-1c — Ops

### 1. FCM prune (notifications service + repository + jobs router)

The send loop currently ignores the response entirely. Change: inspect status;
on **404/410 (UNREGISTERED)** → `repo.delete_token(token)` (new method); log
other non-2xx at warning. Push stays best-effort.

**Commit trap:** `notify_assignment` runs *after* the router's commit, inside
`contextlib.suppress` — a token deletion flushed there would never commit. Fix
in `jobs/router.py::assign`: after the notify call, `await session.commit()`
(second commit on the same session is legal and keeps "router owns the
boundary" intact).

### 2. Sentry (`core/config.py`, `main.py`, `pyproject.toml`)

- `sentry-sdk[fastapi]` dependency; new setting `sentry_dsn: str = ""` — empty
  ⇒ off (same pattern as FCM, boots fine without the account).
- Init guarded in `create_app()`: `send_default_pii=False`,
  `max_request_body_size="never"` (request bodies carry customer names/phones —
  set explicitly, don't trust SDK defaults), `traces_sample_rate=0` (errors
  only; latency was fixed by the region move, don't buy tracing yet),
  `environment=settings.environment`.

### 3. Request-ID middleware (`core/request_id.py`, `main.py`)

~20-line Starlette middleware, no new dependency: uuid4 per request →
contextvar → `X-Request-ID` response header → `logging.Filter` injects it into
log lines → Sentry tag. This is what turns "my payment disappeared" from
archaeology into a grep.

### Tests (1c)
- FCM: fake transport returning 404 → token row deleted; 500 → kept + logged.
- Request-ID: header present on responses; filter injects into records.

---

## Gates, deploy, verification

**Per-PR gates** (the standing ones): `ruff format --check` · `ruff check` ·
`mypy app` (strict — new deps: sentry-sdk ships typed) · `pytest app` · CI's
real-Postgres job (`alembic upgrade head` + `alembic check` + integration).
Note for 1a: `alembic check` passes because model columns and migration 0013
are introduced together.

**Deploy runbook** (after all three merge):
1. Pre-deploy Railway variables: `FIXFLOW_ENVIRONMENT=production`, optionally
   `FIXFLOW_SENTRY_DSN=<dsn>`. (Do this FIRST — the boot guard auto-detects
   Railway anyway, and the JWT secret is already set, so order only matters if
   the secret were missing.)
2. From a **clean checkout of `main`**, `backend/`:
   `railway up --service efficient-tenderness --detach`.
3. Verify, in order:
   - `/api/health` 200; `alembic_version` = `0013`.
   - `/openapi.json` lists `/technicians/{id}/pin` and
     `/technicians/{id}/revoke-sessions`.
   - Web login works (proves old tokens/protocol unaffected).
   - 6 wrong PINs on a test account → 429 + `Retry-After`; correct PIN after
     the window → 200 and counter reset.
   - Create a job (token retry path inert but exercised), claim an assigned job
     via curl → 409.
   - `X-Request-ID` on any response.
4. **Rollback**: Railway dashboard → previous deployment. Migration 0013 is
   additive; the old image ignores the new columns. No down-migration needed.

**Post-deploy operations (owner, same day):**
- Rotate the **manager PIN to 6 digits** via Swagger (`/docs`, manager token)
  — safe immediately (web has no outbox).
- Rotate **technician PINs** — also safe immediately *because set-PIN doesn't
  revoke sessions* (their phones stay logged in; the new PIN applies at next
  login).
- **Do NOT use `revoke-sessions`** on an active technician until the Phase 3
  APK is on their phone (it would 401 their device and the old outbox drops
  queued writes). Lost/stolen phone = the intended exception.

**Forward-compat notes for later phases:**
- Phase 3's outbox v2 pauses (not drops) on 401 — after its rollout, the
  revoke restriction above lifts, and "bump version on PIN change" can be
  reconsidered.
- Phase 4's money guards will reuse the 409 + `JobConflictError` shape
  introduced in 1b — keep the error type general (`detail` string, no
  claim-specific naming).

**Sizing:** 1a ≈ 1 day (the lockout tests are most of it) · 1b ≈ half day ·
1c ≈ half day · deploy + verification ≈ 1–2 h. Total ≈ 2 days.
