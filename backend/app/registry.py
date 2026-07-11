"""ORM model registry.

Side-effect imports every feature's `models` module so SQLAlchemy populates
`Base.metadata` with the full schema. Imported by Alembic (`alembic/env.py`),
the test fixtures (`tests/conftest.py`), the `scripts/`, **and the running app
itself** (`app/main.py`) — the app entrypoint MUST import this, or models only
reached transitively via routers register while `tenancy`/`catalog` don't,
leaving dangling cross-slice FKs (e.g. `technician.shop_id` → `shop`) that make
every `session.flush()` raise `NoReferencedTableError`. `create_app()` accesses
`Base.metadata.sorted_tables` at boot to fail-fast if this import is ever lost.

**Add a line below when a feature adds new ORM models.**
"""

from __future__ import annotations

from app.core.db import Base
from app.features.attendance import models as _attendance_models  # noqa: F401
from app.features.catalog import models as _catalog_models  # noqa: F401
from app.features.customer_messaging import models as _customer_messaging_models  # noqa: F401
from app.features.customers import models as _customers_models  # noqa: F401
from app.features.identity import models as _identity_models  # noqa: F401
from app.features.jobs import models as _jobs_models  # noqa: F401
from app.features.media import models as _media_models  # noqa: F401
from app.features.notifications import models as _notifications_models  # noqa: F401
from app.features.telemetry import models as _telemetry_models  # noqa: F401
from app.features.tenancy import models as _tenancy_models  # noqa: F401

__all__ = ["Base"]
