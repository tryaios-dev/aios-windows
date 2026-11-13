"""Loopback client for one running engine (llama-server's OpenAI-compatible API).

Sync, because chat answers are produced in a worker thread (``aios_backend.local``). The engine's
port and key never leave the backend, and no content is logged.

Reasoning ("thinking") text is never part of an answer, so it is never shown, stored or sent back
to the model with the next message (AC-07): thinking is switched off in the chat template, the
server's ``reasoning_content`` is ignored, and any ``<think>`` block that still reaches
``content`` is dropped by ``ThinkFilter``.
"""

import json
import time
from collections.abc import Iterator
from dataclasses import dataclass

import httpx

from aios_backend.engine.launcher import Engine

OPEN, CLOSE = "<think>", "</think>"


class EngineAnswerError(Exception):
    """The engine refused the request or broke off. ``str(exc)`` is a short code."""


class ThinkFilter:
    """Drops ``<think>…</think>`` from streamed text, even when a tag is split across chunks."""

    def __init__(self) -> None:
        self._buffer = ""
        self._inside = False

    def feed(self, text: str) -> str:
        self._buffer += text
        out: list[str] = []
        while self._buffer:
            tag = CLOSE if self._inside else OPEN
            at = self._buffer.find(tag)
            if at >= 0:
                if not self._inside:
                    out.append(self._buffer[:at])
                self._buffer = self._buffer[at + len(tag) :]
                self._inside = not self._inside
                continue
            # keep a possible partial tag for the next chunk
            keep = next(
                (n for n in range(len(tag) - 1, 0, -1) if self._buffer.endswith(tag[:n])), 0
            )
            if not self._inside:
                out.append(self._buffer[: len(self._buffer) - keep])
            self._buffer = self._buffer[len(self._buffer) - keep :]
            break
        return "".join(out)

    def flush(self) -> str:
        rest, self._buffer = ("" if self._inside else self._buffer), ""
        return rest


def _body(messages: list[dict[str, str]], max_tokens: int | None) -> dict[str, object]:
    body: dict[str, object] = {
        "messages": messages,
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    if max_tokens is not None:
        body["max_tokens"] = max_tokens
    return body


def _events(resp: httpx.Response) -> Iterator[dict[str, object]]:
    for line in resp.iter_lines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            event = json.loads(data)
        except ValueError:
            continue
        if isinstance(event, dict):
            if "error" in event:
                raise EngineAnswerError("engine_error")
            yield event


def _delta(event: dict[str, object]) -> str:
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return ""
    delta = choices[0].get("delta")
    content = delta.get("content") if isinstance(delta, dict) else None
    return content if isinstance(content, str) else ""


def stream_chat(
    engine: Engine, messages: list[dict[str, str]], max_tokens: int | None = None
) -> Iterator[str]:
    """Answer text in chunks. Closing the iterator closes the request, so the engine stops."""
    think = ThinkFilter()
    with (
        httpx.Client(timeout=httpx.Timeout(600.0, connect=5.0), trust_env=False) as client,
        client.stream(
            "POST",
            f"{engine.base_url}/v1/chat/completions",
            json=_body(messages, max_tokens),
            headers={"Authorization": f"Bearer {engine.key}"},
        ) as resp,
    ):
        if resp.status_code != 200:
            raise EngineAnswerError(f"engine_status_{resp.status_code}")
        for event in _events(resp):
            text = think.feed(_delta(event))
            if text:
                yield text
        rest = think.flush()
        if rest:
            yield rest


@dataclass(frozen=True)
class Measured:
    tokens_per_second: float
    time_to_first_token_ms: int


BENCHMARK_PROMPT = [
    {"role": "user", "content": "Write three short sentences about the sea, one per line."}
]


def benchmark(engine: Engine, max_tokens: int = 64) -> Measured:
    """One short answer: time to the first words, and generation speed from the engine."""
    began = time.monotonic()
    first: float | None = None
    per_second: float | None = None
    with (
        httpx.Client(timeout=httpx.Timeout(600.0, connect=5.0), trust_env=False) as client,
        client.stream(
            "POST",
            f"{engine.base_url}/v1/chat/completions",
            json=_body(BENCHMARK_PROMPT, max_tokens),
            headers={"Authorization": f"Bearer {engine.key}"},
        ) as resp,
    ):
        if resp.status_code != 200:
            raise EngineAnswerError(f"engine_status_{resp.status_code}")
        pieces = 0
        for event in _events(resp):
            if _delta(event):
                pieces += 1
                if first is None:
                    first = time.monotonic()
            timings = event.get("timings")
            if isinstance(timings, dict) and isinstance(
                timings.get("predicted_per_second"), int | float
            ):
                per_second = float(timings["predicted_per_second"])
    if first is None:
        raise EngineAnswerError("engine_empty_answer")
    if per_second is None:
        elapsed = max(time.monotonic() - first, 1e-3)
        per_second = pieces / elapsed
    return Measured(per_second, round((first - began) * 1000))
