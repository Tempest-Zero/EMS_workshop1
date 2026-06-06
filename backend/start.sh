#!/usr/bin/env sh
# Production entrypoint: apply migrations, then serve. Run on every container
# start so a deploy can never serve against an out-of-date schema. If the
# migration fails the container exits (fail-safe) rather than booting a broken
# app. docker-compose overrides this command for local dev (uvicorn --reload).
set -e

echo "Running database migrations (alembic upgrade head)…"
alembic upgrade head

echo "Starting uvicorn on port ${PORT:-8000}…"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
