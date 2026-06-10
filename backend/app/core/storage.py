"""Cloudflare R2 storage adapter (S3-compatible) — signed URLs for media.

The mobile app NEVER holds R2 credentials. It only sees short-lived signed
URLs minted here on its behalf. Feature services depend on the `StorageClient`
Protocol so unit tests can substitute a fake.

We use pre-signed **PUT** (not a POST policy): PUT is the reliably-supported
path on R2, and the mobile client just PUTs the bytes to the URL. Because a
pre-signed PUT can't enforce `Content-Length` server-side, upload size is
bounded two ways instead: client-side compression (720p) before upload, and a
finalize-time size check (see `r2_max_upload_bytes`) that rejects + purges
anything oversized. That check reads the object's **real** size via
`head_size()` (a `HEAD` on R2), so it can't be bypassed by a client
under-reporting the byte count.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Protocol

import boto3
from botocore.config import Config

from app.core.config import settings

logger = logging.getLogger(__name__)

# How long a signed UPLOAD url stays valid. 10 minutes is generous for a
# technician on a phone (capture → compress → upload over mobile data).
DEFAULT_UPLOAD_TTL = 600

# How long a signed PLAYBACK url stays valid. 1 hour is enough for a manager
# review session; clients can re-fetch the list to get a fresh url.
DEFAULT_PLAYBACK_TTL = 3600


@dataclass(frozen=True)
class SignedUpload:
    signed_url: str
    token: str  # unused for R2 PUT; kept so the response shape is provider-agnostic
    expires_in: int


class StorageClient(Protocol):
    """The narrow surface feature services depend on. Easy to fake in tests."""

    def mint_upload_url(self, path: str) -> SignedUpload: ...
    def mint_playback_url(self, path: str, expires_in: int = DEFAULT_PLAYBACK_TTL) -> str: ...
    def head_size(self, path: str) -> int | None: ...
    def delete(self, path: str) -> None: ...
    def put_bytes(self, path: str, data: bytes, content_type: str) -> None: ...


class R2Storage:
    """Concrete `StorageClient` backed by Cloudflare R2 via the AWS S3 SDK."""

    def __init__(self, client: Any, bucket: str) -> None:  # client: botocore S3 client
        self._client = client
        self._bucket = bucket

    def mint_upload_url(self, path: str) -> SignedUpload:
        url = str(
            self._client.generate_presigned_url(
                "put_object",
                Params={"Bucket": self._bucket, "Key": path},
                ExpiresIn=DEFAULT_UPLOAD_TTL,
            )
        )
        return SignedUpload(signed_url=url, token="", expires_in=DEFAULT_UPLOAD_TTL)

    def mint_playback_url(self, path: str, expires_in: int = DEFAULT_PLAYBACK_TTL) -> str:
        return str(
            self._client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self._bucket, "Key": path},
                ExpiresIn=expires_in,
            )
        )

    def head_size(self, path: str) -> int | None:
        """The object's real byte size from R2, or ``None`` if it can't be read.

        Used at finalize to enforce the upload ceiling against the *actual*
        bytes that landed, not a self-reported number the client could lie
        about (a pre-signed PUT can't cap size server-side). A missing object
        or transient error returns ``None`` so the caller can fall back.
        """
        try:
            head = self._client.head_object(Bucket=self._bucket, Key=path)
        except Exception:  # noqa: BLE001 — object absent / transient → caller falls back
            logger.warning("head_object failed for %s", path, exc_info=True)
            return None
        size = head.get("ContentLength")
        return int(size) if size is not None else None

    def delete(self, path: str) -> None:
        self._client.delete_object(Bucket=self._bucket, Key=path)

    def put_bytes(self, path: str, data: bytes, content_type: str) -> None:
        """Server-side upload for SMALL server-generated artifacts (payroll
        CSVs). Big client media stays on the signed-URL data plane — this
        method must never carry phone uploads."""
        self._client.put_object(Bucket=self._bucket, Key=path, Body=data, ContentType=content_type)


@lru_cache(maxsize=1)
def get_storage() -> R2Storage:
    """FastAPI dependency: returns a process-wide R2Storage.

    The boto3 client is lazy — it validates nothing at construction — so the
    app imports fine without R2 credentials (handy for tests, which mock the
    Protocol and never reach here).
    """
    client = boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )
    return R2Storage(client, settings.r2_bucket)
