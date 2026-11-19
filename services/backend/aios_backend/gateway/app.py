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

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
import uuid
from collections.abc import Iterator
from typing import Any, Literal

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.types import ASGIApp

from aios_backend.apps.chat.answers import AnswerSource
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
    provider: Literal["local", "company"] = "local"


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
    engine_side: AnswerSource, company_side: AnswerSource | None = None
) -> ASGIApp:
    """The gateway as an ASGI app, wrapped in the loopback and token check (IPC-21 to IPC-23).
    ``company_side``: the Company provider (G-06), or None when no server is configured."""
    app = FastAPI(title="AIOS gateway", docs_url=None, redoc_url=None, openapi_url=None)
    sources: dict[str, AnswerSource] = {"local": engine_side}
    if company_side is not None:
        sources["company"] = company_side

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
