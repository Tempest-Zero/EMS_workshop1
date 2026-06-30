"""Create (or update) a read-only ``ops_viewer`` login for the ops console.

No account is seeded by a migration on purpose — a default PIN baked into the
schema is a standing liability. Run this once per teammate instead, choosing the
PIN yourself:

    cd backend
    python -m scripts.create_ops_user --id ops1 --name "Asad (Ops)" --pin 482913

The PIN must be digits only and at least 6 long (the same floor as a manager —
see ``identity.service``). Re-running with the same id updates the name/PIN
(idempotent), so it doubles as a PIN reset. The account is created ``active`` and
with ``role = ops_viewer``, which ``require_ops_access`` admits to ``/api/ops/*``
and nothing else.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.core.db import SessionLocal
from app.features.identity.models import Technician
from app.features.identity.security import hash_pin
from app.features.identity.service import MIN_PIN_DIGITS_MANAGER

_ROLE = "ops_viewer"


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create/update an ops_viewer login.")
    parser.add_argument("--id", required=True, help="stable login id, e.g. 'ops1'")
    parser.add_argument("--name", required=True, help="display name shown in the login picker")
    parser.add_argument("--pin", required=True, help=f"digits only, >= {MIN_PIN_DIGITS_MANAGER}")
    return parser.parse_args(argv)


def _validate_pin(pin: str) -> str | None:
    if not pin.isdigit():
        return "PIN must be digits only."
    if len(pin) < MIN_PIN_DIGITS_MANAGER:
        return f"PIN must be at least {MIN_PIN_DIGITS_MANAGER} digits."
    return None


async def _upsert(tech_id: str, name: str, pin: str) -> str:
    async with SessionLocal() as session:
        tech = await session.get(Technician, tech_id)
        if tech is None:
            session.add(
                Technician(
                    id=tech_id,
                    name=name,
                    specialty="Ops",
                    avatar="bg-slate-700",
                    role=_ROLE,
                    pin_hash=hash_pin(pin),
                    active=True,
                )
            )
            action = "created"
        else:
            tech.name = name
            tech.role = _ROLE
            tech.pin_hash = hash_pin(pin)
            tech.active = True
            action = "updated"
        await session.commit()
    return action


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    error = _validate_pin(args.pin)
    if error:
        print(f"error: {error}", file=sys.stderr)
        return 2
    action = asyncio.run(_upsert(args.id, args.name, args.pin))
    print(f"ops_viewer account '{args.id}' ({args.name}) {action}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
