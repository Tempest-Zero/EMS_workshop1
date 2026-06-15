# Runbook — Database Backups & Restore

The database (Supabase Postgres) holds the cash ledger, payroll history, and
attendance evidence. Backups are **nightly `pg_dump` archives written to
Cloudflare R2** — a different provider from the database, so one provider
incident can't take the data and its backups together.

| What | Value |
| --- | --- |
| Job | `db-backup-nightly` — in-process scheduler, registered in `backend/app/main.py` |
| Schedule | Daily **02:30 Asia/Karachi** (`FIXFLOW_BACKUP_HOUR`/`_MINUTE`) |
| Destination | R2 bucket `job-media`, prefix `backups/db/` (`FIXFLOW_BACKUP_PREFIX`) |
| Format | `pg_dump --format=custom --schema=public --no-owner --no-privileges` |
| Naming | `fixflow-db-<YYYYMMDD>T<HHMMSS>Z.dump` (UTC stamp) |
| Retention | 30 days (`FIXFLOW_BACKUP_RETENTION_DAYS`); pruning **never** deletes keys outside this naming |
| Code | `backend/app/core/backup.py` (policy unit-tested in `backend/tests/test_backup.py`) |
| Failure visibility | Job failures log + report to Sentry (scheduler safe-wrapper) |

**Why `--schema=public`:** only the app's schema is ours; Supabase-internal
schemas (`auth`, `storage`, …) are not ours to dump or restore.
**Why `--no-owner --no-privileges`:** restores into any vanilla Postgres
(the drill target is a plain container, not a Supabase clone).

---

## Verify backups are flowing

R2 dashboard → `job-media` bucket → `backups/db/` — expect an object stamped
within the last ~24 h. Or from `backend/` with the venv:

```
.venv/Scripts/python.exe -c "from app.core.storage import get_storage; print(*get_storage().list_keys('backups/db/'), sep='\n')"
```

(Reads R2 creds from `backend/.env`.)

## Restore — full (disaster: database lost)

1. Get the newest dump: R2 dashboard download, or `mint_playback_url(key)`
   from a python shell as above.
2. Create the target database (new Supabase project or any Postgres ≥ the
   dump's server version). Get its **session-pooler** connection string.
3. Restore:
   ```
   pg_restore --no-owner --no-privileges -d "<target-dsn>" fixflow-db-<stamp>.dump
   ```
4. Point the backend at it: update `FIXFLOW_DATABASE_URL` in Railway →
   redeploy. `start.sh` runs `alembic upgrade head` on boot, which no-ops if
   the dump is current or applies anything newer.
5. Verify: `/api/health`, then spot-check a job detail and the payments ledger
   against a known record.

## Restore — selective (one table damaged)

`--format=custom` supports per-table restore:

```
pg_restore --no-owner --data-only -t job_payment -d "<target-dsn>" <dump>
```

Restore into a scratch DB first and reconcile before touching prod —
`job_payment` is append-only; prefer manual reconciliation over blind import.

## Restore drill (run one after any major schema change)

No Docker. The owner's machine has a **native PostgreSQL 17 on `localhost:5432`**
(`postgres` superuser) — restore into a throwaway DB there. The matching-version
**client tools** (`pg_dump`/`pg_restore`/`psql`) come from the portable EDB zip
at `C:\Users\OGDCL\fixflow-backups\pg17\pgsql\bin` (no installer/services).
`$pg = "C:\Users\OGDCL\fixflow-backups\pg17\pgsql\bin"`:

```powershell
# 1. Dump prod (session-pooler DSN; see connection gotcha below)
& "$pg\pg_dump.exe" "<prod-pooler-dsn>" --format=custom --schema=public `
    --no-owner --no-privileges -f drill.dump

# 2. Restore into a throwaway DB on the local server
& "$pg\psql.exe" -h localhost -p 5432 -U postgres -c "CREATE DATABASE fixflow_restore_drill;"
& "$pg\pg_restore.exe" --no-owner --no-privileges -h localhost -p 5432 -U postgres `
    -d fixflow_restore_drill drill.dump

# 3. Verify — compare to prod
& "$pg\psql.exe" -h localhost -p 5432 -U postgres -d fixflow_restore_drill `
    -c "SELECT count(*) FROM job_payment;"

# 4. Tear down (and delete the dump — it carries real customer/payment data)
& "$pg\psql.exe" -h localhost -p 5432 -U postgres -c "DROP DATABASE fixflow_restore_drill;"
Remove-Item drill.dump
```

Compare row counts of `job`, `job_payment`, `attendance_event`, `technician`
(and ideally all 15 tables) against prod (`pg_stat_user_tables` or direct counts).

**Expected benign warning:** `pg_restore` logs `schema "public" already exists`
(every fresh DB has one) and reports "1 error ignored" — table data still
restores fully. Suppress it by dropping `public` in the new DB before restore if
you want a clean run.

**Portable-server note:** the zip's `postgres.exe`/`pg_ctl` server fails to start
on this machine (`0xC0000142`, missing VC++ runtime DLLs) — that's why the drill
uses the installed native server, not a scratch cluster from the zip. The zip's
*client* binaries work fine.

**Connection gotcha (local machines):** the direct `db.<ref>.supabase.co`
host is IPv6-only — on IPv4-only networks use the session pooler
(`postgres.<ref>@aws-1-ap-south-1.pooler.supabase.com:5432`). pg_dump through
the **session** pooler is fine; never the transaction pooler (port 6543).

## Known limits / wishlist

- **No point-in-time recovery.** Nightly granularity means up to ~24 h of
  writes can be lost between dump and incident. Mobile devices retain queued
  writes in their outbox (replayable), which softens but does not close this.
  PITR = Supabase Pro; recommended once revenue justifies it.
- Dumps live in the same bucket as media (prefix-separated). A dedicated
  bucket with its own credentials would survive a media-bucket credential leak.
- Media files (R2 objects) are NOT covered by these dumps — only their DB
  rows. R2 durability is the current story for bytes; revisit with the
  retention-policy decision (ROADMAP.md, Decision 2).
- Scheduler is in-process, single-replica (documented in `core/scheduler.py`);
  a duplicate run just writes a second timestamped object.

## Drill log

| Date | Dump source | Restored into | Result |
| --- | --- | --- | --- |
| 2026-06-15 | prod (Supabase, via session pooler), PG 17.6 dump | local native PG 17.2, `fixflow_restore_drill` | ✅ all 15 tables match prod (job=19, job_payment=3, attendance_event=9, technician=6, job_event=28); dump also uploaded to R2 as backup #1 (`backups/db/fixflow-db-20260615T102020Z.dump`) |
