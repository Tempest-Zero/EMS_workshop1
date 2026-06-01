"""Shared pytest fixtures.

Kept minimal for Phase 0. As features land we'll add:
  * a transactional `AsyncSession` fixture against a throwaway test DB,
  * an `app_client` fixture that swaps the DB dep with the test session.
"""

from __future__ import annotations
