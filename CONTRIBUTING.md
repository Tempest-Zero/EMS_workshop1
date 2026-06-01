# Contributing to FixFlow

We're a small team (3–5) building FixFlow into a real product. This guide keeps
our work parallel-friendly and `main` always shippable. Read
[`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it explains the modular-monolith /
vertical-slice structure your changes must fit into.

## Local setup

### Web (manager) — at repo root

```bash
npm install      # install dependencies
npm run dev      # start the dev server (http://localhost:5173)
npm test         # run the test suite
npm run lint     # lint
npm run format   # auto-format with Prettier
```

### Backend (FastAPI)

```bash
cd backend
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

cp .env.example .env                # then fill in Supabase keys (see backend/README.md)
uvicorn app.main:app --reload       # http://localhost:8000/api/health
```

Quality gates (same as CI):

```bash
ruff format --check .
ruff check .
mypy app
pytest
```

Database migrations (Alembic):

```bash
alembic revision --autogenerate -m "describe the change"
alembic upgrade head
```

### Mobile (technician-app)

Scaffolds in **Phase 2** of the media slice. See
[`technician-app/README.md`](./technician-app/README.md) for the planned setup.

### Whole stack via Docker Compose

```bash
docker compose up --build           # Postgres + backend, hot-reloading
```

## Branching model

`main` is protected and always green. Nobody commits to it directly — all work
lands through a pull request.

1. Branch off the latest `main`:
   ```bash
   git switch main && git pull
   git switch -c feat/jobs-parts-search
   ```
2. Keep branches **short-lived and scoped to one slice / concern.** A branch that
   touches three features is a sign it should be three branches.
3. Name branches `type/scope-short-description`, e.g.
   `feat/attendance-export`, `fix/jobs-estimate-rounding`,
   `refactor/shared-date-helpers`.

### Branch & commit types

We use [Conventional Commits](https://www.conventionalcommits.org/):

| Type        | When to use                          |
| ----------- | ------------------------------------ |
| `feat:`     | a new capability                     |
| `fix:`      | a bug fix                            |
| `refactor:` | code change with no behaviour change |
| `test:`     | adding or fixing tests               |
| `docs:`     | documentation only                   |
| `chore:`    | tooling, deps, config                |

Example: `feat(jobs): add parts search to the estimate editor`.

## Where does my code go?

Decide first **which runtime** the change belongs to (web · backend · mobile),
then **which slice** inside it. Stay inside that slice.

### Web (`src/`)

- A screen, component, or data change for an existing capability →
  `src/features/<that-feature>/`.
- A genuinely reusable, dependency-free UI piece or helper → `src/shared/`.
- Routing, layouts, global store, app-wide wiring → `src/app/`.
- A brand-new capability → a new `src/features/<name>/`.

### Backend (`backend/app/`)

- API + DB work for an existing capability → `backend/app/features/<that-feature>/`.
  Stay inside `router.py`, `schemas.py`, `models.py`, `service.py`,
  `repository.py`, `tests/`.
- Cross-slice helpers (errors, pagination, base schemas) → `backend/app/shared/`.
- A brand-new capability → a new `backend/app/features/<name>/`. If the slice
  needs a database table, add an Alembic migration in the same PR.
- **Never** import another slice's `repository.py` or `models.py`. Call its
  `service.py` instead — that's the contracted surface.

### Mobile (`technician-app/`)

(Scaffolds in Phase 2.) Same convention: `technician-app/src/features/<name>/`.

Respect the dependency rules in `ARCHITECTURE.md`. The most common mistake on
the web side is reaching into another feature's `pages`/barrel; on the backend
side it's reaching past `service.py` into another slice's internals.

## Tests

- Put tests next to the code: `Thing.test.js` / `Thing.test.jsx`.
- Pure logic (`shared/lib`, feature `data` helpers) should have unit tests.
- Components can use Testing Library (`render` + `screen`); see
  `src/shared/ui/Avatar.test.jsx` for the pattern.

## Opening a pull request

Before you push, make sure the gates for the side(s) you touched pass locally —
CI runs both jobs (frontend + backend) on every PR:

**Web:**

```bash
npm run lint
npm run format:check
npm test
npm run build
```

**Backend:**

```bash
cd backend
ruff format --check .
ruff check .
mypy app
pytest
```

Then open a PR into `main`. The template will prompt you for a summary, the
slice you touched, and a checklist.

- At least **one review** is required; CI must be green.
- Prefer **squash merge** to keep `main` history linear and readable.
- Link the issue your PR closes.

## Definition of done

- Behaviour works in both relevant roles (Manager and/or Technician).
- Lint, format, tests and build are green.
- Stayed within slice boundaries; cross-feature reuse follows the rules.
- Docs/tests updated where it matters.
