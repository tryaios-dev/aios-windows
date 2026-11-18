"""Dictation sessions: audio in, text out, phrase by phrase (ADR 0016).

The window sends about 250 ms of audio at a time. Each call returns at once with the text so
far; a phrase is turned into text in the background as soon as a pause ends it, so the words
appear while the person keeps talking. Done turns the rest into text and returns all of it.

Nothing is stored: the audio is dropped as soon as its phrase is turned into text, and the text
lives only in memory until the window takes it (open decision 1 of ADR 0016: the sound is not
kept). Logs carry durations and counts, never words (SR-07).
"""

import asyncio
import contextlib
import secrets
import time
from dataclasses import dataclass, field

from aios_backend.errors import AppError
from aios_backend.voice import VoiceError, VoiceManager, Whisper
from aios_backend.voice.phrases import BYTES_PER_SAMPLE, RATE, Phrases, audio_ctx, clean, wav
from aios_common.logging import get_logger, log_event

MAX_SESSION_S = 600.0  # ten minutes of audio
STALE_S = 120.0  # a session nothing has been sent to for this long is dropped
MAX_SESSIONS = 1  # one window, one microphone

log = get_logger("voice")


@dataclass
class Session:
    id: str
    started: float = field(default_factory=time.monotonic)
    seen: float = field(default_factory=time.monotonic)
    received_s: float = 0.0
    phrases: Phrases = field(default_factory=Phrases)
    text: list[str] = field(default_factory=list)
    queue: "asyncio.Queue[bytes | None]" = field(default_factory=asyncio.Queue)
    worker: "asyncio.Task[None] | None" = None
    pending: int = 0  # phrases cut but not yet turned into text
    error: str | None = None

    @property
    def joined(self) -> str:
        return " ".join(t for t in self.text if t)


class Sessions:
    def __init__(self, manager: VoiceManager) -> None:
        self._manager = manager
        self._sessions: dict[str, Session] = {}

    async def open(self) -> Session:
        """Start whisper-server if needed and open a session. Opening a second one ends the
        first (one microphone)."""
        self._drop_stale()
        try:
            await self._manager.ensure()
        except VoiceError as exc:
            code = str(exc)
            if code in ("voice_not_built", "voice_no_model"):
                raise AppError(code, 409) from None
            raise AppError("voice_failed", 503) from None
        while len(self._sessions) >= MAX_SESSIONS:
            await self.cancel(next(iter(self._sessions)))
        session = Session(secrets.token_hex(16))
        session.worker = asyncio.create_task(self._work(session))
        self._sessions[session.id] = session
        return session

    async def audio(self, session_id: str, pcm: bytes) -> Session:
        """Add audio; returns at once with the text so far."""
        session = self._get(session_id)
        if session.error:
            raise AppError(session.error, 503)
        seconds = len(pcm) / (RATE * BYTES_PER_SAMPLE)
        if session.received_s + seconds > MAX_SESSION_S:
            raise AppError("voice_too_long", 409)
        session.received_s += seconds
        session.seen = time.monotonic()
        self._manager.touch()
        for phrase in session.phrases.add(pcm):
            session.pending += 1
            session.queue.put_nowait(phrase)
        return session

    async def finish(self, session_id: str) -> str:
        """Turn the rest into text and return all of it. The session ends."""
        session = self._get(session_id)
        last = session.phrases.flush()
        if last is not None:
            session.pending += 1
            session.queue.put_nowait(last)
        session.queue.put_nowait(None)  # the worker stops after the last phrase
        try:
            if session.worker is not None:
                await session.worker
        finally:
            self._sessions.pop(session.id, None)
        if session.error and not session.text:
            raise AppError(session.error, 503)
        log_event(
            log,
            "voice_session_finished",
            duration_ms=round(session.received_s * 1000),
            count=len(session.text),
        )
        return session.joined

    async def cancel(self, session_id: str) -> None:
        """Stop and throw away what was heard. Unknown ids are fine: already gone."""
        session = self._sessions.pop(session_id, None)
        if session is None:
            return
        if session.worker is not None:
            session.worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await session.worker
        log_event(log, "voice_session_cancelled", duration_ms=round(session.received_s * 1000))

    async def close(self) -> None:
        for session_id in list(self._sessions):
            await self.cancel(session_id)

    # ---- internals ------------------------------------------------------------------------

    def _get(self, session_id: str) -> Session:
        self._drop_stale()
        session = self._sessions.get(session_id)
        if session is None:
            raise AppError("voice_session_not_found", 404)
        return session

    def _drop_stale(self) -> None:
        now = time.monotonic()
        for session in [s for s in self._sessions.values() if now - s.seen > STALE_S]:
            self._sessions.pop(session.id, None)
            if session.worker is not None:
                session.worker.cancel()

    async def _work(self, session: Session) -> None:
        """Turn the session's phrases into text, one at a time, in order."""
        while (phrase := await session.queue.get()) is not None:
            try:
                text = await self._transcribe(phrase)
            except VoiceError as exc:
                session.error = "voice_failed"
                log_event(log, "voice_transcribe_failed", error_code=str(exc))
                text = ""
            session.text.append(clean(text))
            session.pending -= 1

    async def _transcribe(self, phrase: bytes) -> str:
        began = time.monotonic()
        whisper: Whisper = await self._manager.ensure()
        try:
            text = await asyncio.to_thread(whisper.transcribe, wav(phrase), audio_ctx(phrase))
        except VoiceError:
            if not await self._manager.lost_gpu(whisper):
                raise
            whisper = await self._manager.ensure()  # the GPU build died: once more on the CPU
            text = await asyncio.to_thread(whisper.transcribe, wav(phrase), audio_ctx(phrase))
        log_event(
            log,
            "voice_phrase",
            component=whisper.build,
            duration_ms=round((time.monotonic() - began) * 1000),
        )
        return text
