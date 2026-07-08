"""ORM model registry.

Side-effect imports every feature's `models` module so SQLAlchemy populates
`Base.metadata` with the full schema. Both Alembic (`alembic/env.py`) and any
test fixture that needs to create the schema import from here.

**Add a line below when a feature adds new ORM models.**
"""

from __future__ import annotations

from app.core.db import Base
from app.features.attendance import models as _attendance_models  # noqa: F401
from app.features.catalog import models as _catalog_models  # noqa: F401
from app.features.customers import models as _customers_models  # noqa: F401
from app.features.identity import models as _identity_models  # noqa: F401
from app.features.jobs import models as _jobs_models  # noqa: F401
from app.features.media import models as _media_models  # noqa: F401
from app.features.notifications import models as _notifications_models  # noqa: F401
from app.features.telemetry import models as _telemetry_models  # noqa: F401
from app.features.tenancy import models as _tenancy_models  # noqa: F401

__all__ = ["Base"]
