"""Request and response bodies for dictation (UI types VoiceStatus, VoiceSession, VoiceText)."""

from typing import Literal

from pydantic import BaseModel, Field

# 2 s of 16 kHz 16-bit mono audio per call, base64: the window sends about 250 ms.
MAX_AUDIO_B64 = 86_000


class ModelStatus(BaseModel):
    """The speech model: on this computer, or being downloaded (setup, Settings > Voice)."""

    status: Literal["missing", "downloading", "verifying", "ready", "failed"]
    received_bytes: int
    total_bytes: int
    error: str | None


class VoiceStatus(BaseModel):
    state: Literal["not_built", "no_model", "not_started", "starting", "ready", "failed"]
    build: Literal["cpu", "vulkan"] | None
    model: ModelStatus


class OpenIn(BaseModel):
    """The computer's languages as the window sees them, main first: used while none are
    chosen in Settings > Voice."""

    languages: list[str] = Field(default_factory=list, max_length=5)


class VoiceSessionOut(BaseModel):
    session_id: str


class AudioIn(BaseModel):
    """16 kHz, mono, 16-bit little-endian PCM, base64."""

    pcm: str = Field(max_length=MAX_AUDIO_B64, pattern=r"^[A-Za-z0-9+/]*={0,2}$")


class VoiceText(BaseModel):
    """The words heard so far. ``pending``: a phrase is still being turned into text."""

    text: str
    pending: bool


class FinishedText(BaseModel):
    text: str
