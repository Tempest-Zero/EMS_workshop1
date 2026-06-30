"""Environment-driven configuration.

`pydantic-settings` reads from `backend/.env` (gitignored) with the
`FIXFLOW_` prefix. The single `settings` instance is imported by every module
that needs config — never read env vars directly.
"""

from __future__ import annotations

import os

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The built-in JWT secret. Safe for local dev; production MUST override it. The
# boot guard below refuses to start a production process still using this value.
DEV_JWT_SECRET = "dev-insecure-secret-change-me-in-production-32b"  # noqa: S105


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="FIXFLOW_",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Database (SQLAlchemy async URL) — Supabase Postgres ──────────────
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/fixflow"

    # ── Cloudflare R2 (media object storage; S3-compatible) ──────────────
    # Backend mints short-lived signed URLs; the mobile app never holds these.
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = "job-media"
    # Hard ceiling enforced at finalize: oversized uploads are rejected + purged.
    # 30 MB comfortably fits a 60s 720p clip while blocking abuse.
    r2_max_upload_bytes: int = 30 * 1024 * 1024

    # ── Attendance ───────────────────────────────────────────────────────
    # A selfie is a single still — far smaller than a 720p video clip.
    attendance_selfie_max_bytes: int = 5 * 1024 * 1024
    # Device-clock drift beyond this (seconds) is flagged for manager review.
    attendance_drift_flag_seconds: int = 120
    # A GPS fix whose reported accuracy is worse than this (metres) — or that
    # reports no accuracy at all — is too coarse to judge the geofence:
    # inside_geofence stays NULL (uncertain) and the punch gets the
    # "no reliable location" flag instead of a false inside/outside verdict.
    attendance_location_accuracy_ceiling_m: float = 200.0
    # A mobile punch whose selfie hasn't reached storage after this many hours
    # surfaces on the manager's selfie-gaps reconciliation list (the punch
    # itself stays valid — evidence is flagged, never blocking).
    attendance_selfie_grace_hours: int = 24

    # ── Jobs / billing ───────────────────────────────────────────────────
    # Labour rate used to auto-generate the bill from time on-site. Integer
    # paisa (Rs 1200/hour). Money is ALWAYS integer paisa, never floats.
    labour_rate_paisa: int = 1200 * 100
    # Fuel/running cost per km for the GPS route estimate (Phase 3). Integer
    # paisa per kilometre (Rs 20/km) — applied to the straight-line distance
    # between the depart-workshop and arrive-customer pins.
    fuel_rate_paisa_per_km: int = 20 * 100

    # ── Push (Firebase Cloud Messaging, HTTP v1) ─────────────────────────
    # The FCM service-account JSON, base64-encoded (set in Railway). The backend
    # mints an OAuth token from it and sends "job assigned" pushes directly to
    # FCM — no Expo relay, so nothing needs uploading to EAS. Empty = push off.
    fcm_service_account_b64: str = ""

    # ── Auth (Name + PIN → JWT) ──────────────────────────────────────────
    # HS256 signing secret. The default is for local dev only — production
    # MUST override it via FIXFLOW_JWT_SECRET (a long random string).
    jwt_secret: str = DEV_JWT_SECRET
    # Long-lived by design: a workshop device stays logged in. Refresh/logout
    # flows are deferred. 30 days.
    jwt_expire_minutes: int = 60 * 24 * 30

    # ── Environment / observability ──────────────────────────────────────
    # "dev" | "production". Drives the boot guard (below) and the Sentry env
    # tag. Railway is also auto-detected via RAILWAY_ENVIRONMENT, so the guard
    # is fail-closed even if this is left unset in prod.
    environment: str = "dev"
    # Sentry DSN — empty disables error reporting (boots fine without an account).
    sentry_dsn: str = ""

    # ── Ops console: Railway API proxy ───────────────────────────────────
    # The standalone ops app never holds these — the backend proxies Railway's
    # GraphQL so a teammate's browser only ever sees filtered, role-gated JSON.
    # All empty = the Railway tabs report "not configured" instead of crashing.
    # Token: a Railway account/team token (Railway dashboard → Account → Tokens).
    railway_api_token: str = ""
    railway_project_id: str = ""
    railway_environment_id: str = ""
    # Optional name→service-id map (e.g. {"web": "...", "backend": "...",
    # "ops": "..."}). If empty, services are resolved dynamically from the
    # project/environment. JSON in FIXFLOW_RAILWAY_SERVICE_IDS.
    railway_service_ids: dict[str, str] = {}
    # Cache window (seconds) for Railway responses — Railway rate-limits, and the
    # ops UI polls. One cached read is shared across concurrent pollers.
    railway_cache_ttl_seconds: int = 20

    # ── Ops console: Sentry issues feed (REST API, not the ingest DSN) ────
    # A Sentry auth token with read scope (event:read, project:read). Distinct
    # from sentry_dsn (which is write-only ingest). Empty = the Sentry tab is
    # reported "not configured".
    sentry_auth_token: str = ""
    sentry_org: str = ""
    # Project slugs per runtime; any left empty is simply omitted from the feed.
    sentry_project_web: str = ""
    sentry_project_backend: str = ""
    sentry_project_mobile: str = ""

    # ── Scheduler (in-process APScheduler) ───────────────────────────────
    # ASSUMES A SINGLE REPLICA: each replica would run its own scheduler and
    # duplicate every job. If the service is ever scaled out, move the jobs to
    # an external cron (Railway cron hitting admin endpoints) or add a DB lock.
    enable_scheduler: bool = True
    # Cron spec for the weekly payroll export, in the shop's timezone.
    # Default: every Sunday at 18:00 Asia/Karachi (the client's payroll cycle).
    scheduler_timezone: str = "Asia/Karachi"

    # ── Backups (nightly pg_dump → R2) ───────────────────────────────────
    # Dumps land in the media bucket under `backup_prefix` — on a DIFFERENT
    # provider from the database (Cloudflare vs Supabase), so one provider
    # incident can't take the data and its backups together. Runs on the
    # in-process scheduler (same single-replica contract; a duplicate run is
    # harmless). Restore procedure + drill log: docs/RUNBOOK-BACKUPS.md.
    backup_enabled: bool = True
    # 02:30 shop time: after the workday, clear of the Sunday 18:00 payroll job.
    backup_hour: int = 2
    backup_minute: int = 30
    backup_retention_days: int = 30
    backup_prefix: str = "backups/db/"

    # ── HTTP ─────────────────────────────────────────────────────────────
    cors_origins: list[str] = [
        "http://localhost:5173",  # web (manager / Vite dev server)
        "http://localhost:5174",  # ops console (separate Vite dev server)
        "http://localhost:8081",  # Expo dev server (Metro)
    ]

    @property
    def is_production(self) -> bool:
        """True in a real deployment. Either we were told (``FIXFLOW_ENVIRONMENT
        =production``) or Railway's own env var is present."""
        return self.environment.lower() == "production" or bool(os.getenv("RAILWAY_ENVIRONMENT"))

    def assert_safe_for_production(self) -> None:
        """Fail-closed boot guard: refuse to run a production process that is
        still using the insecure dev JWT secret. Called from ``create_app()``;
        raising here exits the container (Railway shows a crash-loop) rather
        than silently serving forgeable tokens."""
        if self.is_production and self.jwt_secret == DEV_JWT_SECRET:
            raise RuntimeError(
                "FIXFLOW_JWT_SECRET is still the insecure dev default in a "
                "production environment. Set a long random secret and redeploy."
            )

    @field_validator("database_url")
    @classmethod
    def _ensure_async_driver(cls, v: str) -> str:
        """Coerce a bare ``postgresql://`` scheme to the async driver.

        Supabase (and most dashboards) hand you a ``postgresql://`` URL. Left
        as-is, SQLAlchemy picks the psycopg2 dialect — which we don't install —
        and the app crashes on boot. Rewriting to ``postgresql+asyncpg://``
        means a pasted pooler/Supabase string just works.
        """
        if v.startswith("postgresql://"):
            return "postgresql+asyncpg://" + v[len("postgresql://") :]
        return v


settings = Settings()
