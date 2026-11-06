"""SPIKE-D04: forward one chat completion to the local engine and stream it back.

The engine's port and key never leave the backend. Nothing is stored and no content is
logged: only status codes and timings.
"""

import time
from collections.abc import AsyncIterator

import httpx

from aios_backend.apps.spike.schemas import ChatCompletionRequest
from aios_backend.engine import Engine, EngineError, EngineManager, NoModel
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


async def stream_completion(
    manager: EngineManager, req: ChatCompletionRequest
) -> AsyncIterator[bytes]:
    """Engine server-sent events, passed through unchanged (OpenAI chunk format).

    Holds the engine for the whole answer so it is not unloaded mid-stream. If the GPU engine
    dies before the first byte of the answer, the same request is sent once more, now to the
    CPU build (D-06: "an answer from the CPU build and a notice, not a dead chat"). Once text
    has been sent it cannot be continued cleanly: that answer ends with ``engine_error`` and
    the next one runs on the CPU build.
    """
    began = time.monotonic()
    status = 0
    try:
        for attempt in (1, 2):
            sent = False
            async with manager.use() as engine:
                try:
                    async with (
                        httpx.AsyncClient(timeout=httpx.Timeout(600, connect=5)) as client,
                        client.stream(
                            "POST",
                            f"{engine.base_url}/v1/chat/completions",
                            json=engine_body(req),
                            headers={"Authorization": f"Bearer {engine.key}"},
                        ) as resp,
                    ):
                        status = resp.status_code
                        if status == 200:
                            async for chunk in resp.aiter_raw():
                                sent = True
                                yield chunk
                            return
                except httpx.HTTPError:
                    status = 0
                if attempt == 1 and not sent and await manager.lost_gpu(engine):
                    log_event(log, "spike_retry_on_cpu", error_code="engine_crashed")
                    continue
            yield b'data: {"error": "engine_error"}\n\n'
            return
    except (EngineError, NoModel):
        yield b'data: {"error": "engine_failed"}\n\n'
    finally:
        log_event(
            log,
            "spike_completion",
            status=status,
            duration_ms=round((time.monotonic() - began) * 1000),
        )
