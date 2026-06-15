# Slim image for both dev (via docker-compose with bind mount + --reload) and
# the eventual prod build. asyncpg needs no system libpq, but build-essential
# helps any compiled-on-install wheel transitions cleanly.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /code

# pg_dump for the nightly backup job (core/backup.py). The PGDG repo because
# pg_dump's major version must be >= the server's, and Supabase runs PG 17
# while Debian bookworm ships client 15.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-17 \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so the layer caches when only source changes.
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

# App code.
COPY . .

EXPOSE 8000

# start.sh runs `alembic upgrade head` and then execs uvicorn, so every deploy
# migrates before serving (no more manual upgrades). $PORT is injected by the
# PaaS host (Railway / Render / Fly); docker-compose overrides this command for
# dev (--reload), so local dev is unaffected.
CMD ["sh", "start.sh"]
