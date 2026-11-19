"""Request and response bodies for pictures and videos (UI type MediaItem)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from aios_backend.media import MAX_NEGATIVE, MAX_PROMPT, MAX_SEED

Kind = Literal["image", "video"]
Status = Literal["queued", "running", "done", "failed", "cancelled"]


class MediaModelOut(BaseModel):
    id: str
    kind: Kind


class MediaStatusOut(BaseModel):
    """Whether pictures and videos can be made now, and with which models.

    ``reason`` when not: ``company_provider_disabled`` (no company server set up),
    ``media_not_offered`` (the server has no media service), ``company_key_missing``,
    ``company_key_rejected``, ``media_unreachable`` or ``media_unavailable``."""

    available: bool
    reason: str | None
    models: list[MediaModelOut]


class MediaCreate(BaseModel):
    """What to make. ``confirmed``: the person agreed, in the dialog, that the description goes
    to the company server (not needed in a project that already uses the company server)."""

    model_config = ConfigDict(extra="forbid")

    kind: Kind
    model: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT)
    negative_prompt: str | None = Field(default=None, max_length=MAX_NEGATIVE)
    width: int = Field(ge=64, le=4096)
    height: int = Field(ge=64, le=4096)
    frames: int | None = Field(default=None, ge=1, le=1000)
    seed: int | None = Field(default=None, ge=0, le=MAX_SEED)
    confirmed: bool = False


class MediaItemOut(BaseModel):
    id: str
    project_id: str
    kind: Kind
    model: str
    prompt: str
    negative_prompt: str | None
    width: int
    height: int
    frames: int | None
    seed: int
    status: Status
    progress: float  # 0 to 1
    position: int | None  # jobs ahead of this one on the server
    error_code: str | None
    mime: str | None
    size_bytes: int | None
    created_at: datetime
    finished_at: datetime | None


class MediaContentOut(BaseModel):
    """The file, base64 encoded, to show in the window."""

    id: str
    mime: str
    data_base64: str


class MediaSaveIn(BaseModel):
    """Where to save a copy: a path the person chose in the system save dialog."""

    path: str = Field(min_length=1, max_length=1024)


class MediaSavedOut(BaseModel):
    path: str
    size_bytes: int
