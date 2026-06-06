"""Environment-driven configuration.

`pydantic-settings` reads from `backend/.env` (gitignored) with the
`FIXFLOW_` prefix. The single `settings` instance is imported by every module
that needs config — never read env vars directly.
"""

from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # ── Auth (Name + PIN → JWT) ──────────────────────────────────────────
    # HS256 signing secret. The default is for local dev only — production
    # MUST override it via FIXFLOW_JWT_SECRET (a long random string).
    jwt_secret: str = "dev-insecure-secret-change-me-in-production-32b"  # noqa: S105 — dev default; prod overrides via env
    # Long-lived by design: a workshop device stays logged in. Refresh/logout
    # flows are deferred. 30 days.
    jwt_expire_minutes: int = 60 * 24 * 30

    # ── HTTP ─────────────────────────────────────────────────────────────
    cors_origins: list[str] = [
        "http://localhost:5173",  # web (manager / Vite dev server)
        "http://localhost:8081",  # Expo dev server (Metro)
    ]

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
