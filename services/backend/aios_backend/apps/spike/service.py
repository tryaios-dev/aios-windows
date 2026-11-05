"""SPIKE-D04: forward one chat completion to the local engine and stream it back.

The engine's port and key never leave the backend. Nothing is stored and no content is
logged: only status codes and timings.
"""

import time
from collections.abc import AsyncIterator

import httpx

from aios_backend.apps.spike.schemas import ChatCompletionRequest
from aios_backend.engine import Engine, EngineManager
from aios_common.logging import get_logger, log_event

log = get_logger("spike")


async def start_engine(manager: EngineManager) -> Engine:
    return await manager.ensure()


def engine_body(req: ChatCompletionRequest) -> dict[str, object]:
    return {
        "messages": [m.model_dump() for m in req.messages],
        "max_tokens": req.max_tokens,
        "stream": True,
        "stream_options": {"include_usage": True},
        # Qwen3 thinks before answering by default; the spike measures time to first words.
        "chat_template_kwargs": {"enable_thinking": False},
    }


async def stream_completion(engine: Engine, req: ChatCompletionRequest) -> AsyncIterator[bytes]:
    """Engine server-sent events, passed through unchanged (OpenAI chunk format)."""
    began = time.monotonic()
    status = 0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as client:
            async with client.stream(
                "POST",
                f"{engine.base_url}/v1/chat/completions",
                json=engine_body(req),
                headers={"Authorization": f"Bearer {engine.key}"},
            ) as resp:
                status = resp.status_code
                if status != 200:
                    yield b'data: {"error": "engine_error"}\n\n'
                    return
                async for chunk in resp.aiter_raw():
                    yield chunk
    finally:
        log_event(
            log,
            "spike_completion",
            status=status,
            duration_ms=round((time.monotonic() - began) * 1000),
        )
