"""Regression guard for the runtime ORM model-registration gap.

The app entrypoint (`uvicorn app.main:app`) MUST import `app.registry`, so the
FULL ORM schema lands in `Base.metadata`. Without it, only models reached
transitively through the router graph register; `tenancy` (shop/area) and
`catalog` never do — leaving dangling cross-slice FKs (e.g. `technician.shop_id`
→ `shop`) that make every `session.flush()` raise `NoReferencedTableError`, so
every write endpoint 500s while reads look healthy. (Prod incident: manager
login returned 500 for every attempt.)

This runs in a SUBPROCESS on purpose. The in-process test harness
(`tests/conftest.py`) imports `app.registry` directly, which pre-populates the
metadata and would MASK a regression. A fresh interpreter that imports only
`app.main` reproduces exactly what uvicorn does at boot.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent

# Tables reachable ONLY via `app.registry` (never transitively from `app.main`'s
# router graph). Their absence after importing `app.main` is exactly the bug.
_REGISTRY_ONLY_TABLES = {
    "shop",
    "area",
    "appliance_category",
    "appliance_brand",
    "appliance_model",
    "part",
    "fault_code",
    "action_code",
}


def test_app_entrypoint_registers_full_schema() -> None:
    # Import ONLY app.main — exactly uvicorn's boot path — then force the same
    # whole-metadata topological sort a flush performs. `sorted_tables` raises
    # NoReferencedTableError if any FK target table is unregistered, so a broken
    # graph exits the child non-zero (the prod fail-fast) rather than 500ing.
    script = (
        "import app.main\n"
        "from app.core.db import Base\n"
        "Base.metadata.sorted_tables\n"
        "print(' '.join(sorted(Base.metadata.tables)))\n"
    )
    # Force a dev environment so the child fails only for a broken graph, never
    # for the production JWT boot guard. Inherit the rest of the env (Windows
    # needs SYSTEMROOT etc. for the interpreter to start at all).
    env = {**os.environ, "FIXFLOW_ENVIRONMENT": "dev", "FIXFLOW_JWT_SECRET": "test-secret-not-dev"}
    env.pop("RAILWAY_ENVIRONMENT", None)

    result = subprocess.run(  # noqa: S603 — hardcoded literal command, no untrusted input
        [sys.executable, "-c", script],
        capture_output=True,
        text=True,
        cwd=_BACKEND_DIR,
        env=env,
    )

    assert result.returncode == 0, (
        "importing app.main left a structurally broken ORM graph "
        f"(likely a missing `import app.registry`):\n{result.stderr}"
    )
    registered = set(result.stdout.split())
    missing = _REGISTRY_ONLY_TABLES - registered
    assert not missing, f"app.main did not register these tables: {sorted(missing)}"
