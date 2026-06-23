# FixFlow Backend

FastAPI service. The **control plane** for the FixFlow modular monolith — it owns
business rules, persistence, and (later) auth. Each business capability lives as
a self-contained module under `app/features/<slice>/`, mirroring the frontend's
vertical-slice layout.

> **Live.** The backend runs at
> `https://efficient-tenderness-production-2d09.up.railway.app` (Railway), with migrations
> applied automatically on deploy (`start.sh`). Shipped slices: `identity` (Name + PIN → JWT,
> technician roster), `jobs` (intake → estimate → payment → close), `attendance` (selfie + GPS
> clock-in/out, append-only log, daily rollups, payroll export), `media` (Cloudflare R2-backed
> before/after capture), and `notifications` (FCM push). **Auth is enforced** — endpoints require
> a JWT and manager-only routes reject technician tokens (403). See
> [`docs/ROADMAP.md`](../docs/ROADMAP.md) for current work and
> [`docs/PLAYBOOK.md`](../docs/PLAYBOOK.md) before adding a slice.

## Layout

```
backend/
  app/
    main.py                 # FastAPI app factory + router registration
    core/
      config.py             # pydantic-settings (env-driven)
      db.py                 # async SQLAlchemy engine + session dep
    features/<slice>/
      router.py             # FastAPI APIRouter for this slice
      schemas.py            # Pydantic request/response models
      models.py             # SQLAlchemy ORM models
      service.py            # business logic
      repository.py         # data access
      tests/
    shared/                 # errors, pagination, base schemas (cross-slice)
  alembic/                  # database migrations
  tests/                    # cross-cutting integration tests
  pyproject.toml            # deps, ruff, mypy, pytest config
  Dockerfile
  .env.example
```

## Local dev

```bash
# (one-time) create a venv and install deps + dev extras
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

# copy the env template and fill in your DB URL + Cloudflare R2 keys
cp .env.example .env

# run the API
uvicorn app.main:app --reload --port 8000
# -> http://localhost:8000/api/health  →  {"status": "ok"}
```

…or with Docker Compose (from repo root):

```bash
docker compose up --build
```

That starts a local Postgres + the backend. Supabase replaces the Postgres
container once the Supabase project is set up — just change
`FIXFLOW_DATABASE_URL` in `.env`.

## Quality gates (run before pushing — CI runs the same)

```bash
ruff format --check .
ruff check .
mypy app
pytest
```

## Migrations (Alembic)

```bash
# create a new migration after editing models
alembic revision --autogenerate -m "add media table"

# apply migrations
alembic upgrade head
```

Alembic is wired for SQLAlchemy 2.0 async (see `alembic/env.py`).

## Architecture rules

- **Each feature is a slice.** Add a folder under `app/features/`; keep its
  router, schemas, models, service and tests inside it.
- **No cross-slice imports of internals.** Talk to another slice via its
  service layer (the public surface), not its repository or model.
- **`shared/` is dependency-free.** Pure helpers, base classes, error types.
- **The phone never holds storage credentials.** The mobile app only ever sees
  short-lived signed R2 URLs minted by this backend.

See the top-level [`ARCHITECTURE.md`](../ARCHITECTURE.md) for how the backend
slices map to the frontend ones.
