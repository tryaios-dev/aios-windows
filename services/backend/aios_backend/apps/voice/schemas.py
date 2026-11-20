"""Request and response bodies for dictation (UI types VoiceStatus, VoiceSession, VoiceText)."""

from typing import Literal

from pydantic import BaseModel, Field

# 2 s of 16 kHz 16-bit mono audio per call, base64: the window sends about 250 ms.
MAX_AUDIO_B64 = 86_000
# A recording is sent in parts of up to 30 s (base64 of 960 000 bytes, plus a margin).
MAX_RECORDING_PART_B64 = 1_300_000
MAX_RECORDING_S = 7200.0


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


class RecordingIn(BaseModel):
    """A recording the window decoded: its length, and the computer's languages as in OpenIn."""

    seconds: float = Field(gt=0, le=MAX_RECORDING_S)
    languages: list[str] = Field(default_factory=list, max_length=5)


class RecordingAudioIn(BaseModel):
    """The next part of the recording: 16 kHz, mono, 16-bit little-endian PCM, base64."""

    pcm: str = Field(max_length=MAX_RECORDING_PART_B64, pattern=r"^[A-Za-z0-9+/]*={0,2}$")


class RecordingOut(BaseModel):
    """Progress of a recording being turned into text. ``waiting_s``: audio received but not yet
    turned into text; the window sends the next part only while it is under ``backlog_s``."""

    recording_id: str
    state: Literal["working", "done", "stopped", "failed"]
    total_s: float
    done_s: float
    waiting_s: float
    backlog_s: float
    text: str


class TakeIn(BaseModel):
    """Where the text goes: a conversation, or a project (a new conversation in it)."""

    conversation_id: str | None = Field(default=None, max_length=64)
    project_id: str | None = Field(default=None, max_length=64)
