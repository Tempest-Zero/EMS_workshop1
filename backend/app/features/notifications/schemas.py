"""Request/response models for the notifications slice."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["android", "ios"]


class DeviceRegister(BaseModel):
    """The mobile app registers its Expo push token after login. The device
    fields (W10) are optional and additive — older clients send only the token;
    a client that includes ``installation_id`` also registers/refreshes its row
    in the fleet registry and links the token to it."""

    token: str = Field(..., min_length=1, max_length=256)
    platform: Platform = "android"
    installation_id: str | None = Field(default=None, max_length=64)
    app_version: str | None = Field(default=None, max_length=32)
    os_version: str | None = Field(default=None, max_length=32)
