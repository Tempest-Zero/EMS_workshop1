# Slim image for both dev (via docker-compose with bind mount + --reload) and
# the eventual prod build. asyncpg needs no system libpq, but build-essential
# helps any compiled-on-install wheel transitions cleanly.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /code

# pg_dump for the nightly backup job (core/backup.py), pinned to client 17 to
# match Supabase's server major (pg_dump's major must be >= the server's).
# The PGDG repo is keyed to the image's ACTUAL Debian codename: python:3.12-slim
# tracks the current Debian stable (now trixie, was bookworm), so a hardcoded
# codename breaks the build whenever the base image rolls forward.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential curl ca-certificates \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
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
