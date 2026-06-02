"""Environment-driven configuration.

`pydantic-settings` reads from `backend/.env` (gitignored) with the
`FIXFLOW_` prefix. The single `settings` instance is imported by every module
that needs config — never read env vars directly.
"""

from __future__ import annotations

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

    # ── HTTP ─────────────────────────────────────────────────────────────
    cors_origins: list[str] = [
        "http://localhost:5173",  # web (manager / Vite dev server)
        "http://localhost:8081",  # Expo dev server (Metro)
    ]


settings = Settings()
