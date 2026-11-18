"""HTTP endpoints for dictation (ADR 0016). Thin: the sessions live in service.py."""

import base64
import binascii

from fastapi import APIRouter, Request, status

from aios_backend.apps.voice.schemas import (
    AudioIn,
    FinishedText,
    VoiceSessionOut,
    VoiceStatus,
    VoiceText,
)
from aios_backend.apps.voice.service import Sessions
from aios_backend.errors import AppError

router = APIRouter(prefix="/voice", tags=["voice"])


def _sessions(request: Request) -> Sessions:
    sessions: Sessions = request.app.state.voice_sessions
    return sessions


@router.get("/status", summary="Whether speaking instead of typing can be used now")
def voice_status(request: Request) -> VoiceStatus:
    state, build = request.app.state.voice.state()
    return VoiceStatus(state=state.value, build=build)


@router.post(
    "/sessions",
    summary="Start listening: starts the speech engine if needed",
    responses={
        409: {"description": "voice_not_built, voice_no_model"},
        503: {"description": "voice_failed"},
    },
)
async def open_session(request: Request) -> VoiceSessionOut:
    session = await _sessions(request).open()
    return VoiceSessionOut(session_id=session.id)


@router.post("/sessions/{session_id}/audio", summary="Add audio; returns the text so far at once")
async def add_audio(session_id: str, body: AudioIn, request: Request) -> VoiceText:
    try:
        pcm = base64.b64decode(body.pcm, validate=True)
    except binascii.Error:
        raise AppError("invalid_request", 422) from None
    session = await _sessions(request).audio(session_id, pcm)
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
