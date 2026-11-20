"""The local AI gateway (G-01): the only inference endpoint on the device (IPC-02).

An OpenAI-compatible ``POST /v1/chat/completions`` on its own loopback port inside backend.exe. It
accepts only ``derive(T, "aios/ipc/v1/gateway")`` as bearer (Process and IPC v1, section 5); the
backend's provider router is its only caller. No docs, no other paths. Nothing here logs message
text (SR-07).

Behind it, by the request's optional ``provider`` field:

* ``local`` (the default, so older callers keep working): the engine side (the local model
  module, ``aios_backend.local``), which starts llama-server on demand and talks to it with the
  engine's own derived token;
* ``company``: the company's AI server (``aios_backend.company``, G-06), only when one is
  configured. Without a company side such a request is answered ``model_not_found``.

When the provider reports its own token counts, the stream ends with one OpenAI-style usage chunk
(empty ``choices``) before ``[DONE]``, so chat stores real counts instead of estimates (G-03).

Pictures and short videos (R-7) use ``/v1/media/...``: list the models, start a job, follow it,
fetch its file, cancel it. They go to the company server's media service
(``aios_backend.media.company``), only when one is configured; otherwise ``media_unavailable``.

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
import uuid
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import FastAPI, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.types import ASGIApp

from aios_backend.apps.chat.answers import AnswerSource
from aios_backend.media import (
    MAX_NEGATIVE,
    MAX_PROMPT,
    MAX_SEED,
    MediaError,
    MediaJob,
    MediaSource,
    check_job,
)
from aios_common.asgi_auth import LoopbackTokenMiddleware
from aios_common.handshake import derive

GATEWAY_PURPOSE = "aios/ipc/v1/gateway"


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=1_000_000)


class ChatRequest(BaseModel):
    model: str = Field(min_length=1, max_length=100)
    messages: list[ChatMessage] = Field(min_length=1)
    stream: bool = True
    # Which side answers. Optional, default local: older callers keep working.
    provider: Literal["local", "company", "resource"] = "local"


class MediaJobIn(BaseModel):
    """A picture or video to make (R-7). Nothing else is accepted: never a workflow or a file."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["image", "video"]
    model: str = Field(min_length=1, max_length=64)
    prompt: str = Field(min_length=1, max_length=MAX_PROMPT)
    negative_prompt: str | None = Field(default=None, max_length=MAX_NEGATIVE)
    width: int
    height: int
    seed: int = Field(ge=0, le=MAX_SEED)
    frames: int | None = None


def _media_error(exc: MediaError) -> JSONResponse:
    return JSONResponse({"error": exc.code}, status_code=exc.status)


def _chunk(completion_id: str, model: str, delta: dict[str, Any], finish: str | None = None) -> str:
    body = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(body)}\n\n"


def _usage(chunks: object) -> dict[str, int] | None:
    usage = getattr(chunks, "usage", None)
    if isinstance(usage, tuple) and len(usage) == 2 and all(isinstance(n, int) for n in usage):
        return {"prompt_tokens": usage[0], "completion_tokens": usage[1]}
    return None


def create_gateway_app(
    engine_side: AnswerSource,
    company_side: AnswerSource | None = None,
    media_side: MediaSource | None = None,
    resource_side: AnswerSource | None = None,
) -> ASGIApp:
    """The gateway as an ASGI app, wrapped in the loopback and token check (IPC-21 to IPC-23).
    ``company_side``: the Company provider (G-06), or None when no server is configured.
    ``media_side``: the company server's media service (R-7), or None.
    ``resource_side``: the linked resources (``aios_backend.linked``), or None."""
    app = FastAPI(title="AIOS gateway", docs_url=None, redoc_url=None, openapi_url=None)
    _media_routes(app, media_side)
    sources: dict[str, AnswerSource] = {"local": engine_side}
    if company_side is not None:
        sources["company"] = company_side
    if resource_side is not None:
        sources["resource"] = resource_side

    @app.post("/v1/chat/completions", response_model=None)
    def chat_completions(body: ChatRequest) -> StreamingResponse | JSONResponse | dict[str, Any]:
        provider = body.provider
        source = sources.get(provider)
        info = source.model(provider, body.model) if source is not None else None
        if source is None or info is None:
            return JSONResponse({"error": "model_not_found"}, status_code=404)
        messages = [m.model_dump() for m in body.messages]
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"

        if not body.stream:
            chunks = source.answer(provider, info.model_id, messages)
            text = "".join(chunks)
            whole: dict[str, Any] = {
                "id": completion_id,
                "object": "chat.completion",
                "model": info.model_id,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
            }
            usage = _usage(chunks)
            if usage is not None:
                whole["usage"] = usage
            return whole

        def events() -> Iterator[str]:
            chunks = source.answer(provider, info.model_id, messages)
            try:
                yield _chunk(completion_id, info.model_id, {"role": "assistant"})
                for text in chunks:
                    yield _chunk(completion_id, info.model_id, {"content": text})
                yield _chunk(completion_id, info.model_id, {}, finish="stop")
                usage = _usage(chunks)
                if usage is not None:
                    tail = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "model": info.model_id,
                        "choices": [],
                        "usage": usage,
                    }
                    yield f"data: {json.dumps(tail)}\n\n"
                yield "data: [DONE]\n\n"
            except Exception:
                # The stream has started, so the status is already 200: say so in the stream.
                yield f"data: {json.dumps({'error': {'code': 'engine_failed'}})}\n\n"
            finally:
                close = getattr(chunks, "close", None)
                if callable(close):
                    close()  # the caller went away (Stop): the engine stops too

        return StreamingResponse(events(), media_type="text/event-stream")

    return LoopbackTokenMiddleware(app, expected=lambda: derive(GATEWAY_PURPOSE).encode())


def _media_routes(app: FastAPI, side: MediaSource | None) -> None:
    """``/v1/media/...``: the media service's API as the server offers it, checked first."""

    def run(call: Any) -> Any:
        if side is None:
            return JSONResponse({"error": "media_unavailable"}, status_code=503)
        try:
            return call(side)
        except MediaError as exc:
            return _media_error(exc)

    @app.get("/v1/media/models", response_model=None)
    def media_models() -> Any:
        return run(lambda s: {"data": [{"id": m.id, "kind": m.kind} for m in s.media_models()]})

    @app.post("/v1/media/jobs", response_model=None)
    def media_submit(body: MediaJobIn) -> Any:
        job = MediaJob(**body.model_dump())

        def submit(s: MediaSource) -> Any:
            check_job(job)
            return JSONResponse(s.media_submit(job).to_json(), status_code=202)

        return run(submit)

    @app.get("/v1/media/jobs/{job_id}", response_model=None)
    def media_job(job_id: str) -> Any:
        return run(lambda s: s.media_job(job_id).to_json())

    @app.get("/v1/media/jobs/{job_id}/outputs/{index}", response_model=None)
    def media_output(job_id: str, index: int) -> Any:
        def output(s: MediaSource) -> Response:
            data, mime = s.media_output(job_id, index)
            return Response(content=data, media_type=mime)

        return run(output)

    @app.delete("/v1/media/jobs/{job_id}", response_model=None)
    def media_cancel(job_id: str) -> Any:
        def cancel(s: MediaSource) -> Response:
            s.media_cancel(job_id)
            return Response(status_code=204)

        return run(cancel)
