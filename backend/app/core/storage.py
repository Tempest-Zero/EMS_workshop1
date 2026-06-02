"""Supabase Storage adapter — used by any feature that needs signed URLs.

The mobile app NEVER holds the Supabase service key. It only sees short-lived
signed URLs minted here on its behalf. This module is the single point that
talks to `supabase-py`; feature services depend on the `StorageClient`
Protocol so unit tests can substitute a fake.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from supabase import Client, create_client

from app.core.config import settings

# How long a signed UPLOAD url stays valid. 10 minutes is generous for a
# technician on a phone (capture → compress → upload over mobile data).
DEFAULT_UPLOAD_TTL = 600

# How long a signed PLAYBACK url stays valid. 1 hour is enough for a manager
# review session; clients can re-fetch the list to get a fresh url.
DEFAULT_PLAYBACK_TTL = 3600


@dataclass(frozen=True)
class SignedUpload:
    signed_url: str
    token: str
    expires_in: int


class StorageClient(Protocol):
    """The narrow surface feature services depend on. Easy to fake in tests."""

    def mint_upload_url(self, path: str) -> SignedUpload: ...
    def mint_playback_url(self, path: str, expires_in: int = DEFAULT_PLAYBACK_TTL) -> str: ...
    def delete(self, path: str) -> None: ...


class SupabaseStorage:
    """Concrete `StorageClient` backed by `supabase-py`."""

    def __init__(self, client: Client, bucket: str) -> None:
        self._client = client
        self._bucket = bucket

    def mint_upload_url(self, path: str) -> SignedUpload:
        resp = self._client.storage.from_(self._bucket).create_signed_upload_url(path)
        return SignedUpload(
            signed_url=_pluck(resp, "signed_url", "signedUrl"),
            token=_pluck(resp, "token"),
            expires_in=DEFAULT_UPLOAD_TTL,
        )

    def mint_playback_url(self, path: str, expires_in: int = DEFAULT_PLAYBACK_TTL) -> str:
        resp = self._client.storage.from_(self._bucket).create_signed_url(path, expires_in)
        return _pluck(resp, "signed_url", "signedUrl")

    def delete(self, path: str) -> None:
        self._client.storage.from_(self._bucket).remove([path])


def _pluck(obj: object, *keys: str) -> str:
    """Read first matching key from a dict OR attribute from an object.

    supabase-py occasionally swaps return shapes between minor releases; this
    keeps us resilient to that without complicating call sites.
    """
    for k in keys:
        v = obj.get(k) if isinstance(obj, dict) else getattr(obj, k, None)
        if v:
            return str(v)
    return ""


@lru_cache(maxsize=1)
def get_storage() -> SupabaseStorage:
    """FastAPI dependency: returns a process-wide SupabaseStorage."""
    client = create_client(settings.supabase_url, settings.supabase_service_key)
    return SupabaseStorage(client, settings.supabase_storage_bucket)
