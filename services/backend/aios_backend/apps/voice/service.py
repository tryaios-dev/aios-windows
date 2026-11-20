"""Dictation sessions: audio in, text out, phrase by phrase (ADR 0016).

The window sends about 250 ms of audio at a time. Each call returns at once with the text so
far; a phrase is turned into text in the background as soon as a pause ends it, so the words
appear while the person keeps talking. Done turns the rest into text and returns all of it.

Recordings (the Voice notes skill) take the same path: the window decodes the file into the
same audio and sends it in larger parts, and a job turns it into text phrase by phrase, with
progress and Stop (``Recordings``).

Nothing is stored: the audio is dropped as soon as its phrase is turned into text, and the text
lives only in memory until the window takes it (open decision 1 of ADR 0016: the sound is not
kept). Logs carry durations and counts, never words (SR-07). When the text of a recording is put
into a conversation, Activity records that it happened, never the text.
"""

import asyncio
import contextlib
import secrets
import time
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy.orm import Session as DbSession

from aios_backend.apps.voice import repository as repo
from aios_backend.apps.voice.schemas import ModelStatus, VoiceStatus
from aios_backend.errors import AppError
from aios_backend.voice import VoiceError, VoiceManager, Whisper
from aios_backend.voice import languages as langs
from aios_backend.voice.phrases import BYTES_PER_SAMPLE, RATE, Phrases, clean, wav
from aios_common.logging import get_logger, log_event
from db import lookups

MAX_SESSION_S = 600.0  # ten minutes of audio
STALE_S = 120.0  # a session nothing has been sent to for this long is dropped
MAX_SESSIONS = 1  # one window, one microphone
# Recordings: the window holds the decoded audio in memory (about 115 MB an hour at 16 kHz).
MAX_RECORDING_S = 2 * 3600.0
RECORDING_STALE_S = 120.0  # a job the window has not asked about for this long is dropped
# Audio waiting to be turned into text; above this the window waits before sending more.
BACKLOG_S = 60.0

log = get_logger("voice")


def status(manager: VoiceManager) -> VoiceStatus:
    state, build = manager.state()
    d = manager.downloader.state
    if d.status in ("downloading", "verifying", "failed"):
        model = ModelStatus(
            status=d.status,
            received_bytes=d.received_bytes,
            total_bytes=d.total_bytes,
            error=d.error,
        )
    else:
        ready = manager.model_path.is_file()
        model = ModelStatus(
            status="ready" if ready else "missing",
            received_bytes=d.total_bytes if ready else 0,
            total_bytes=d.total_bytes,
            error=None,
        )
    return VoiceStatus(state=state.value, build=build, model=model)


def download_model(manager: VoiceManager) -> VoiceStatus:
    """Start the speech model download unless it is here already or on its way."""
    if not manager.model_path.is_file():
        manager.downloader.start()
    return status(manager)


def languages(db: DbSession, suggested: list[str]) -> tuple[str, ...]:
    """The languages for a dictation: the ones chosen in Settings > Voice, else the computer's
    as the window sees them (unknown ones dropped), else none (Whisper's own guess)."""
    chosen = lookups.voice_languages(db)
    if chosen:
        return chosen
    known: list[str] = []
    for code in suggested:
        if code in langs.CODES and code not in known:
            known.append(code)
    return tuple(known[: langs.MAX_LANGUAGES])


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
    queued_s: float = 0.0  # their length
    error: str | None = None
    # The languages the person speaks, main first; empty: Whisper's own guess (voice/languages).
    languages: tuple[str, ...] = ()
    settled: str | None = None  # the language of this dictation, once a clear phrase decided it
    # A clear phrase may decide the language for the rest (dictation). A recording can change
    # language part way (a meeting), so there each phrase is checked.
    settles: bool = True

    @property
    def joined(self) -> str:
        return " ".join(t for t in self.text if t)

    def queue_phrase(self, phrase: bytes) -> None:
        self.pending += 1
        self.queued_s += _seconds(phrase)
        self.queue.put_nowait(phrase)


@dataclass
class Recording(Session):
    """A recording file being turned into text (the Voice notes skill)."""

    total_s: float = 0.0  # its length, as the window decoded it
    ended: bool = False  # all of its audio has arrived
    stopped: bool = False  # Stop was pressed: the text so far is kept

    @property
    def state(self) -> Literal["working", "done", "stopped", "failed"]:
        if self.stopped:
            return "stopped"
        if self.worker is not None and self.worker.done() and self.error and not self.text:
            return "failed"
        if self.ended and self.worker is not None and self.worker.done():
            return "done"
        return "working"

    @property
    def done_s(self) -> float:
        """How much of the recording has been dealt with: turned into text, or silence."""
        if self.state == "done":
            return self.total_s
        waiting = self.queued_s + self.phrases.seconds
        return max(0.0, min(self.total_s, self.received_s - waiting))


def _seconds(pcm: bytes) -> float:
    return len(pcm) / (RATE * BYTES_PER_SAMPLE)


def _start_error(exc: VoiceError) -> AppError:
    code = str(exc)
    if code in ("voice_not_built", "voice_no_model"):
        return AppError(code, 409)
    return AppError("voice_failed", 503)


class _Speech:
    """Phrases into text, one at a time and in order, in the right language: shared by
    dictation and recordings."""

    def __init__(self, manager: VoiceManager) -> None:
        self._manager = manager

    async def _work(self, session: Session) -> None:
        while (phrase := await session.queue.get()) is not None:
            try:
                text = await self._transcribe(session, phrase)
            except VoiceError as exc:
                session.error = "voice_failed"
                log_event(log, "voice_transcribe_failed", error_code=str(exc))
                text = ""
            session.text.append(clean(text))
            session.pending -= 1
            session.queued_s = max(0.0, session.queued_s - _seconds(phrase))

    async def _transcribe(self, session: Session, phrase: bytes) -> str:
        began = time.monotonic()
        whisper: Whisper = await self._manager.ensure()
        try:
            text = await self._in_language(whisper, session, phrase)
        except VoiceError:
            if not await self._manager.lost_gpu(whisper):
                raise
            whisper = await self._manager.ensure()  # the GPU build died: once more on the CPU
            text = await self._in_language(whisper, session, phrase)
        log_event(
            log,
            "voice_phrase",
            component=whisper.build,
            duration_ms=round((time.monotonic() - began) * 1000),
        )
        return text

    async def _in_language(self, whisper: Whisper, session: Session, phrase: bytes) -> str:
        """Turn the phrase into text in the right language (aios_backend.voice.languages)."""
        audio = wav(phrase)
        language = session.settled
        if language is None and len(session.languages) == 1:
            language = session.languages[0]
        elif language is None and session.languages:
            scores = await asyncio.to_thread(whisper.detect, audio)
            language, clear = langs.choose(scores, session.languages)
            if clear and session.settles and _seconds(phrase) >= langs.SETTLE_S:
                session.settled = language
        return await asyncio.to_thread(whisper.transcribe, audio, language or "auto")


class Sessions(_Speech):
    def __init__(self, manager: VoiceManager) -> None:
        super().__init__(manager)
        self._sessions: dict[str, Session] = {}

    async def open(self, languages: tuple[str, ...] = ()) -> Session:
        """Start whisper-server if needed and open a session. Opening a second one ends the
        first (one microphone). ``languages``: the ones the person speaks, main first."""
        self._drop_stale()
        try:
            await self._manager.ensure()
        except VoiceError as exc:
            raise _start_error(exc) from None
        while len(self._sessions) >= MAX_SESSIONS:
            await self.cancel(next(iter(self._sessions)))
        session = Session(secrets.token_hex(16), languages=languages)
        session.worker = asyncio.create_task(self._work(session))
        self._sessions[session.id] = session
        return session

    async def audio(self, session_id: str, pcm: bytes) -> Session:
        """Add audio; returns at once with the text so far."""
        session = self._get(session_id)
        if session.error:
            raise AppError(session.error, 503)
        seconds = _seconds(pcm)
        if session.received_s + seconds > MAX_SESSION_S:
            raise AppError("voice_too_long", 409)
        session.received_s += seconds
        session.seen = time.monotonic()
        self._manager.touch()
        for phrase in session.phrases.add(pcm):
            session.queue_phrase(phrase)
        return session

    async def finish(self, session_id: str) -> str:
        """Turn the rest into text and return all of it. The session ends."""
        session = self._get(session_id)
        last = session.phrases.flush()
        if last is not None:
            session.queue_phrase(last)
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


class Recordings(_Speech):
    """Recording files turned into text (the Voice notes skill), one at a time.

    The window decodes the file into the audio dictation sends and sends it in parts of up to
    30 s; each part returns at once with the progress. While more than BACKLOG_S of audio waits
    to be turned into text, the window waits before sending the next part, so neither side holds
    much of it. Stop keeps the text written so far; taking the text ends the job.
    """

    def __init__(self, manager: VoiceManager) -> None:
        super().__init__(manager)
        self._jobs: dict[str, Recording] = {}

    async def open(self, languages: tuple[str, ...], seconds: float) -> Recording:
        """Start whisper-server if needed and start a job for a recording ``seconds`` long. A
        second one ends the first (the window shows one at a time)."""
        if seconds > MAX_RECORDING_S:
            raise AppError("voice_recording_too_long", 409)
        self._drop_stale()
        try:
            await self._manager.ensure()
        except VoiceError as exc:
            raise _start_error(exc) from None
        for job_id in list(self._jobs):
            await self.discard(job_id)
        job = Recording(secrets.token_hex(16), languages=languages, total_s=seconds, settles=False)
        job.worker = asyncio.create_task(self._work(job))
        self._jobs[job.id] = job
        return job

    async def audio(self, job_id: str, pcm: bytes) -> Recording:
        """Add the next part of the recording; returns at once with the progress."""
        job = self._get(job_id)
        if job.ended or job.stopped:
            raise AppError("voice_recording_ended", 409)
        if job.error and not job.text:
            raise AppError(job.error, 503)
        seconds = _seconds(pcm)
        if job.received_s + seconds > job.total_s + 1.0:  # a second of rounding
            raise AppError("voice_too_long", 409)
        job.received_s += seconds
        self._manager.touch()
        for phrase in await asyncio.to_thread(job.phrases.add, pcm):
            job.queue_phrase(phrase)
        return job

    def end(self, job_id: str) -> Recording:
        """All of the recording has been sent: what is left becomes the last phrase."""
        job = self._get(job_id)
        if not job.ended and not job.stopped:
            last = job.phrases.flush()
            if last is not None:
                job.queue_phrase(last)
            job.queue.put_nowait(None)
            job.ended = True
        return job

    def get(self, job_id: str) -> Recording:
        job = self._get(job_id)
        if job.state == "working":
            self._manager.touch()
        return job

    async def stop(self, job_id: str) -> Recording:
        """Stop turning the recording into text; what is written so far is kept."""
        job = self._get(job_id)
        if job.state == "working":
            job.stopped = True
            await _cancel(job)
            log_event(log, "voice_recording_stopped", duration_ms=round(job.done_s * 1000))
        return job

    def take(self, job_id: str) -> Recording:
        """The finished (or stopped) job, which ends here: the window puts its text in."""
        job = self._get(job_id)
        if job.state == "working":
            raise AppError("voice_recording_not_done", 409)
        self._jobs.pop(job.id, None)
        if job.state == "failed":
            raise AppError(job.error or "voice_failed", 503)
        log_event(
            log,
            "voice_recording_finished",
            duration_ms=round(job.done_s * 1000),
            count=len(job.text),
        )
        return job

    async def discard(self, job_id: str) -> None:
        """Throw the job and its text away. Unknown ids are fine: already gone."""
        job = self._jobs.pop(job_id, None)
        if job is not None:
            await _cancel(job)
            log_event(log, "voice_recording_cancelled", duration_ms=round(job.done_s * 1000))

    async def close(self) -> None:
        for job_id in list(self._jobs):
            await self.discard(job_id)

    def _get(self, job_id: str) -> Recording:
        self._drop_stale()
        job = self._jobs.get(job_id)
        if job is None:
            raise AppError("voice_recording_not_found", 404)
        job.seen = time.monotonic()
        return job

    def _drop_stale(self) -> None:
        now = time.monotonic()
        for job in [j for j in self._jobs.values() if now - j.seen > RECORDING_STALE_S]:
            self._jobs.pop(job.id, None)
            if job.worker is not None:
                job.worker.cancel()


async def _cancel(session: Session) -> None:
    if session.worker is not None and not session.worker.done():
        session.worker.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await session.worker


def record_transcribed(
    db: DbSession, job: Recording, conversation_id: str | None, project_id: str | None
) -> None:
    """Activity: the text of a recording was put into a conversation or a project. Only that it
    happened, how long the recording was and whether it was stopped; never the text."""
    conversation = repo.get_conversation(db, conversation_id) if conversation_id else None
    if conversation_id and conversation is None:
        raise AppError("conversation_not_found", 404)
    if conversation is not None:
        project_id = conversation.project_id
    if project_id and repo.get_project(db, project_id) is None:
        raise AppError("project_not_found", 404)
    repo.record_event(
        db,
        "recording_transcribed",
        project_id=project_id,
        conversation_id=conversation_id,
        body={
            "seconds": round(job.done_s),
            "phrases": len([t for t in job.text if t]),
            "stopped": job.stopped,
        },
    )


def check_skill(db: DbSession) -> None:
    """Recordings are the Voice notes skill: only while it is added and on."""
    if not repo.skill_enabled(db, "voice"):
        raise AppError("skill_not_enabled", 409)
