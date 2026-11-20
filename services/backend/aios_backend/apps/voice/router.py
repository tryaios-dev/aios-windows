"""HTTP endpoints for dictation (ADR 0016). Thin: the sessions live in service.py."""

import base64
import binascii

from fastapi import APIRouter, Request, status

from aios_backend.apps.voice import service
from aios_backend.apps.voice.schemas import (
    AudioIn,
    FinishedText,
    OpenIn,
    RecordingAudioIn,
    RecordingIn,
    RecordingOut,
    TakeIn,
    VoiceSessionOut,
    VoiceStatus,
    VoiceText,
)
from aios_backend.apps.voice.service import BACKLOG_S, Recording, Recordings, Sessions
from aios_backend.errors import AppError
from db.session import DbSession

router = APIRouter(prefix="/voice", tags=["voice"])


def _sessions(request: Request) -> Sessions:
    sessions: Sessions = request.app.state.voice_sessions
    return sessions


def _recordings(request: Request) -> Recordings:
    recordings: Recordings = request.app.state.voice_recordings
    return recordings


def _progress(job: Recording) -> RecordingOut:
    return RecordingOut(
        recording_id=job.id,
        state=job.state,
        total_s=round(job.total_s, 1),
        done_s=round(job.done_s, 1),
        waiting_s=round(job.queued_s + job.phrases.seconds, 1),
        backlog_s=BACKLOG_S,
        text=job.joined,
    )


def _pcm(b64: str) -> bytes:
    try:
        return base64.b64decode(b64, validate=True)
    except binascii.Error:
        raise AppError("invalid_request", 422) from None


@router.get("/status", summary="Whether speaking instead of typing can be used now")
def voice_status(request: Request) -> VoiceStatus:
    return service.status(request.app.state.voice)


@router.post("/model", summary="Download the speech model (setup, Settings > Voice)")
def download_model(request: Request) -> VoiceStatus:
    return service.download_model(request.app.state.voice)


@router.post(
    "/sessions",
    summary="Start listening: starts the speech engine if needed",
    responses={
        409: {"description": "voice_not_built, voice_no_model"},
        503: {"description": "voice_failed"},
    },
)
async def open_session(
    request: Request, db: DbSession, body: OpenIn | None = None
) -> VoiceSessionOut:
    languages = service.languages(db, body.languages if body else [])
    session = await _sessions(request).open(languages)
    return VoiceSessionOut(session_id=session.id)


@router.post("/sessions/{session_id}/audio", summary="Add audio; returns the text so far at once")
async def add_audio(session_id: str, body: AudioIn, request: Request) -> VoiceText:
    session = await _sessions(request).audio(session_id, _pcm(body.pcm))
    return VoiceText(text=session.joined, pending=session.pending > 0)


@router.post("/sessions/{session_id}/finish", summary="Stop listening and return all the text")
async def finish_session(session_id: str, request: Request) -> FinishedText:
    return FinishedText(text=await _sessions(request).finish(session_id))


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop listening and throw away what was heard",
)
async def cancel_session(session_id: str, request: Request) -> None:
    await _sessions(request).cancel(session_id)


# ---- recordings (the Voice notes skill) --------------------------------------------------


@router.post(
    "/recordings",
    summary="Start turning a recording into text: starts the speech engine if needed",
    responses={
        409: {"description": "skill_not_enabled, voice_not_built, voice_no_model"},
        503: {"description": "voice_failed"},
    },
)
async def open_recording(request: Request, db: DbSession, body: RecordingIn) -> RecordingOut:
    service.check_skill(db)
    languages = service.languages(db, body.languages)
    return _progress(await _recordings(request).open(languages, body.seconds))


@router.post("/recordings/{recording_id}/audio", summary="Add the next part; returns the progress")
async def add_recording_audio(
    recording_id: str, body: RecordingAudioIn, request: Request
) -> RecordingOut:
    return _progress(await _recordings(request).audio(recording_id, _pcm(body.pcm)))


@router.post("/recordings/{recording_id}/end", summary="All of the recording has been sent")
def end_recording(recording_id: str, request: Request) -> RecordingOut:
    return _progress(_recordings(request).end(recording_id))


@router.get("/recordings/{recording_id}", summary="The progress and the text so far")
def recording_progress(recording_id: str, request: Request) -> RecordingOut:
    return _progress(_recordings(request).get(recording_id))


@router.post("/recordings/{recording_id}/stop", summary="Stop; the text written so far is kept")
async def stop_recording(recording_id: str, request: Request) -> RecordingOut:
    return _progress(await _recordings(request).stop(recording_id))


@router.post(
    "/recordings/{recording_id}/take",
    summary="The text, to put into a conversation; Activity records that it happened",
)
def take_recording(
    recording_id: str, body: TakeIn, request: Request, db: DbSession
) -> FinishedText:
    job = _recordings(request).take(recording_id)
    service.record_transcribed(db, job, body.conversation_id, body.project_id)
    return FinishedText(text=job.joined)


@router.delete(
    "/recordings/{recording_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Stop and throw the recording's text away",
)
async def discard_recording(recording_id: str, request: Request) -> None:
    await _recordings(request).discard(recording_id)
