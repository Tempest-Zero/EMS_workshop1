"""Request/response models for the notifications slice."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Platform = Literal["android", "ios"]


class DeviceRegister(BaseModel):
    """The mobile app registers its Expo push token after login."""

    token: str = Field(..., min_length=1, max_length=256)
    platform: Platform = "android"
