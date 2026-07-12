import asyncio
import sys
from pathlib import Path

# Add backend directory to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from app.core.db import AsyncSessionLocal
from app.features.identity.security import hash_password

async def main():
    async with AsyncSessionLocal() as session:
        # Seed manager t1 with a valid strong password and username
        new_password = "Tempest-Zero1!"
        p_hash = hash_password(new_password)
        
        await session.execute(
            text("""
                UPDATE technician
                SET password_hash = :hash,
                    username = 'manager',
                    must_change_password = true
                WHERE id = 't1'
            """),
            {"hash": p_hash}
        )
        await session.commit()
        print("Manager 't1' seeded with username: 'manager', password: 'Tempest-Zero1!'")

if __name__ == "__main__":
    asyncio.run(main())
