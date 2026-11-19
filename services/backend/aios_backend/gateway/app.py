"""The local AI gateway (G-01): the only inference endpoint on the device (IPC-02).

An OpenAI-compatible ``POST /v1/chat/completions`` on its own loopback port inside backend.exe. It
accepts only ``derive(T, "aios/ipc/v1/gateway")`` as bearer (Process and IPC v1, section 5); the
backend's provider router is its only caller. Behind it, the engine side (the local model module,
``aios_backend.local``) starts llama-server on demand and talks to it with the engine's own derived
token. No docs, no other paths. Nothing here logs message text (SR-07).

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
# The local engine, and the company server (G-06, aios_backend.company) when one is configured.
PROVIDER = "local"


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


def create_gateway_app(
    engine_side: AnswerSource, company_side: AnswerSource | None = None
) -> ASGIApp:
    """The gateway as an ASGI app, wrapped in the loopback and token check (IPC-21 to IPC-23).
    ``company_side``: the Company provider (G-06), or None when no server is configured."""
    app = FastAPI(title="AIOS gateway", docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/v1/chat/completions", response_model=None)
    def chat_completions(body: ChatRequest) -> StreamingResponse | JSONResponse | dict[str, Any]:
        provider = body.provider
        side = company_side if provider == "company" else engine_side
        info = side.model(provider, body.model) if side is not None else None
        if side is None or info is None:
            return JSONResponse({"error": "model_not_found"}, status_code=404)
        messages = [m.model_dump() for m in body.messages]
        completion_id = f"chatcmpl-{uuid.uuid4().hex}"

        if not body.stream:
            text = "".join(side.answer(provider, info.model_id, messages))
            return {
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

        def events() -> Iterator[str]:
            chunks = side.answer(provider, info.model_id, messages)
            try:
                yield _chunk(completion_id, info.model_id, {"role": "assistant"})
                for text in chunks:
                    yield _chunk(completion_id, info.model_id, {"content": text})
                yield _chunk(completion_id, info.model_id, {}, finish="stop")
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
