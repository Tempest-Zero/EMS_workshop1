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

    # ── Database (SQLAlchemy async URL) ──────────────────────────────────
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/fixflow"

    # ── Supabase (Storage; signed URLs minted server-side) ───────────────
    # SERVICE key is backend-only; never expose to the mobile app.
    supabase_url: str = ""
    supabase_service_key: str = ""
    supabase_storage_bucket: str = "job-media"

    # ── HTTP ─────────────────────────────────────────────────────────────
    cors_origins: list[str] = [
        "http://localhost:5173",  # web (manager / Vite dev server)
        "http://localhost:8081",  # Expo dev server (Metro)
    ]


settings = Settings()
