"""Request and response bodies for settings and the network allowlist (UI types Settings, AllowlistEntry)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class UpdateAvailable(BaseModel):
    version: str = Field(min_length=1, max_length=32)
    size_bytes: int = Field(ge=0)


class SettingsOut(BaseModel):
    update_check: bool
    catalogue_check: bool
    safe_mode_cpu: bool
    default_model_id: str | None
    # Results of the update check (Electron main) and catalogue check (models app); null until run.
    last_update_check: datetime | None
    last_catalogue_check: datetime | None
    update_available: UpdateAvailable | None
    app_version: str
    catalogue_version: str | None
    schema_version: int  # number of the newest applied migration


class SettingsPatch(BaseModel):
    """Only the fields sent change. ``default_model_id: null`` clears the default."""

    update_check: bool | None = None
    catalogue_check: bool | None = None
    safe_mode_cpu: bool | None = None
    default_model_id: str | None = Field(default=None, min_length=1, max_length=100)


class UpdateCheckIn(BaseModel):
    """What Electron main's updater found. ``null``: no update waiting."""

    update_available: UpdateAvailable | None


class AllowlistEntry(BaseModel):
    id: str
    host: str
    port: int
    purpose: str
    kind: Literal["fixed", "configured"]
    enabled: bool
