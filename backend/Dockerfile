# Slim image for both dev (via docker-compose with bind mount + --reload) and
# the eventual prod build. asyncpg needs no system libpq, but build-essential
# helps any compiled-on-install wheel transitions cleanly.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /code

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps first so the layer caches when only source changes.
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

# App code.
COPY . .

EXPOSE 8000

# Shell form so ${PORT} expands. PaaS hosts (Railway / Render / Fly) inject the
# port to bind via $PORT; locally it defaults to 8000. docker-compose overrides
# this command for dev (--reload), so it's unaffected.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
