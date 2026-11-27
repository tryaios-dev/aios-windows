"""Linked resources: cloud AI models the person links on the Resources page (DeepSeek, Gemini,
Kimi, Claude, ChatGPT, Mistral, Perplexity).

A linked resource is a third chat provider, ``resource``, next to ``local`` and ``company``. Most
are answered over the same OpenAI-compatible protocol as the Company server
(``company.CompanySource``); Claude over Anthropic's Messages API (``_Claude``). It is a separate
thing from the Company server: a conversation reaches a linked resource only when the person moves
it there and allows it (invariant 2, PR-03).

A resource can offer several models (Claude Fable, Opus, Sonnet, ...). The person picks one per
conversation; the conversation's ``model_id`` says which resource and which model answers. Each
model is its own side here, with its own reachability check, and tokens are counted per model.

What can be linked and where each key lives is in ``aios_backend.linked_config``. Every request
goes through the network door, allowing only that resource's host (``net.ALLOWLIST`` row
``linked-<id>``), with the key read from the OS key store when the request is made (invariant 3).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
import time
from collections.abc import Callable, Iterator
from typing import Any

from aios_backend import company, net
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.company_config import CompanyConfig, api_root
from aios_backend.engine.client import Streamed
from aios_backend.linked_config import (
    MEDIA,
    PROVIDER,
    SPECS,
    config_for,
    model_ids,
    resource_for,
    stored_key,
)
from aios_backend.media import fal
from aios_backend.prompting import with_system_prompt

SYSTEM_PROMPT = (
    "You are the AIOS assistant, answering through a cloud AI model the user linked. Answer the "
    "user's latest message directly and helpfully. Do not introduce yourself unless asked who "
    "you are."
)
# Anthropic's Messages API (api.anthropic.com/v1/messages).
ANTHROPIC_VERSION = "2026-10-21"
CLAUDE_MAX_TOKENS = 64_000  # an answer's ceiling; streaming keeps long answers within timeouts
# Models that may be rescued by another Claude model when they decline a request (server-side
# fallback, routed by Anthropic by the kind of refusal).
CLAUDE_FALLBACK = frozenset({"claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"})
CLAUDE_FALLBACK_BETA = "server-side-fallback-2026-07-01"


def valid_key(value: str) -> bool:
    return company.valid_key(value)


class _Resource(company.CompanySource):
    """One model of a linked resource over the OpenAI-compatible protocol: its resource's address
    and key (read from the key store at request time) and its own reachability check."""

    provider = PROVIDER
    prefix = "resource"
    system_prompt = SYSTEM_PROMPT

    def __init__(
        self,
        resource_id: str,
        model_id: str,
        linked: Callable[[str], bool],
        clock: Callable[[], float],
        **client: Any,
    ) -> None:
        def config() -> CompanyConfig | None:
            return config_for(resource_id, model_id) if linked(resource_id) else None

        super().__init__(config, lambda: stored_key(resource_id), clock, **client)
        self.stream_usage = SPECS[resource_id].stream_usage


class _Claude(_Resource):
    """A Claude model over Anthropic's Messages API: ``x-api-key`` and ``anthropic-version``
    headers, ``GET /v1/models`` to check, ``POST /v1/messages`` streamed to answer. Reached
    through the network door like every resource."""

    def _headers(self, key: str) -> dict[str, str]:
        return claude_headers(key)

    def _check(self, found: CompanyConfig) -> None:
        key = self._key()
        if key is None:
            raise self._failed("key_missing", found)
        names = _listed(found, claude_headers(key), self._client)
        if isinstance(names, str):
            raise self._failed(names.removeprefix("resource_"), found)
        if found.model_name not in names:
            raise self._failed("model_not_listed", found)

    def _answer(
        self, provider: str, messages: list[dict[str, str]], out: Streamed
    ) -> Iterator[str]:
        found = self._config()
        if provider != self.provider or found is None:
            raise self._failed("provider_disabled")
        key = self._key()
        if key is None:
            raise self._failed("key_missing", found)
        system = "\n\n".join(m["content"] for m in messages if m.get("role") == "system")
        turns = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m.get("role") in ("user", "assistant") and m.get("content")
        ]
        body: dict[str, Any] = {
            "model": found.model_name,
            "max_tokens": CLAUDE_MAX_TOKENS,
            "messages": turns,
            "stream": True,
        }
        if system:
            body["system"] = system
        headers = claude_headers(key)
        if found.model_name in CLAUDE_FALLBACK:
            body["fallbacks"] = "default"
            headers["anthropic-beta"] = CLAUDE_FALLBACK_BETA
        tokens_in = tokens_out = 0
        try:
            with (
                net.outbound_client(
                    net.Allowlist(company=lambda: found.base_url),
                    timeout=net.Timeout(company.ANSWER_TIMEOUT_S, connect=company.CHECK_TIMEOUT_S),
                    **self._client,
                ) as client,
                client.stream(
                    "POST", f"{api_root(found.base_url)}/messages", json=body, headers=headers
                ) as resp,
            ):
                if resp.status_code in (401, 403):
                    raise self._failed("key_rejected", found)
                if resp.status_code != 200:
                    raise self._failed("unreachable", found)
                for event in _claude_events(resp.iter_lines()):
                    kind = event.get("type")
                    if kind == "error":
                        raise self._failed("answer_failed", found)
                    if kind == "message_start":
                        message = event.get("message")
                        usage = message.get("usage") if isinstance(message, dict) else None
                        tokens_in = _input_tokens(usage if isinstance(usage, dict) else {})
                    elif kind == "message_delta":
                        usage = event.get("usage")
                        if isinstance(usage, dict) and isinstance(usage.get("output_tokens"), int):
                            tokens_out = usage["output_tokens"]
                        delta = event.get("delta")
                        stop = delta.get("stop_reason") if isinstance(delta, dict) else None
                        if stop == "refusal":
                            out.usage = (tokens_in, tokens_out)
                            raise self._failed("answer_refused", found)
                    elif kind == "content_block_delta":
                        delta = event.get("delta")
                        if isinstance(delta, dict) and delta.get("type") == "text_delta":
                            text = delta.get("text")
                            if isinstance(text, str) and text:
                                yield text
                    out.usage = (tokens_in, tokens_out)
        except company.CompanyError:
            raise
        except (net.HostNotAllowed, net.HTTPError) as exc:
            raise self._failed("unreachable", found) from exc


def claude_headers(key: str) -> dict[str, str]:
    return {**company.HEADERS, "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION}


def _input_tokens(usage: dict[str, Any]) -> int:
    """Every input token billed: uncached, written to and read from the prompt cache."""
    counts = (
        usage.get("input_tokens"),
        usage.get("cache_creation_input_tokens"),
        usage.get("cache_read_input_tokens"),
    )
    return sum(n for n in counts if isinstance(n, int))


def _claude_events(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    for line in lines:
        if not line.startswith("data:"):
            continue
        try:
            event = json.loads(line[5:].strip())
        except ValueError:
            continue
        if isinstance(event, dict):
            yield event


def _new_side(
    rid: str,
    model_id: str,
    linked: Callable[[str], bool],
    clock: Callable[[], float],
    **client: Any,
) -> _Resource:
    kind = _Claude if SPECS[rid].protocol == "anthropic" else _Resource
    return kind(rid, model_id, linked, clock, **client)


class LinkedResources:
    """The chat ``AnswerSource`` for ``resource``, used by the gateway. A conversation's model
    (``model_id``) says which linked resource and which of its models answers; with none, the
    first linked resource's default model does. Its error codes start with ``resource_``."""

    provider = PROVIDER

    def __init__(
        self,
        pick: Callable[[str | None], str | None] = resource_for,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        self._pick = pick

        def linked(rid: str) -> bool:
            return rid in SPECS and bool(stored_key(rid))

        self._linked = linked
        self._clock = clock
        self._client = client
        # One side per model, made the first time the model is asked for: the models a key can
        # use are known only once the resource is linked.
        self._sides: dict[tuple[str, str], _Resource] = {}

    def _side(self, provider: str, model_id: str | None) -> _Resource | None:
        if provider != self.provider:
            return None
        rid = self._pick(model_id)
        if rid is None or rid not in SPECS:
            return None
        models = model_ids(rid)
        mid = model_id if model_id in models else (models[0] if models else None)
        if mid is None:
            return None
        if (rid, mid) not in self._sides:
            self._sides[(rid, mid)] = _new_side(rid, mid, self._linked, self._clock, **self._client)
        return self._sides[(rid, mid)]

    @property
    def last_error(self) -> str | None:
        return next((s.last_error for s in self._sides.values() if s.last_error), None)

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        side = self._side(provider, model_id)
        return side.model(provider, None) if side is not None else None

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        return with_system_prompt(SYSTEM_PROMPT, messages)

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Streamed:
        side = self._side(provider, model_id)
        if side is None:
            raise company.CompanyError("resource_not_linked")
        return side.answer(provider, model_id, messages)

    def recheck(self) -> ModelInfo | None:
        side = self._side(self.provider, None)
        return side.recheck() if side is not None else None


def check(resource_id: str, key: str, **client: Any) -> str | None:
    """Ask the resource whether ``key`` works, before it is stored. None if it does (it can use
    at least one chat model), else a short code (``resource_key_rejected``,
    ``resource_unreachable``, ``resource_model_not_listed``). A video resource is checked by its
    own API (``aios_backend.media.fal``)."""
    if resource_id in MEDIA:
        return fal.check(resource_id, key, **client)
    found = chat_models(resource_id, key, **client)
    if isinstance(found, str):
        return found
    return None if found else "resource_model_not_listed"


# Words in a model id that mark a model that does not chat: pictures, speech, embeddings, ...
_NOT_CHAT = (
    "embed",
    "image",
    "imagen",
    "veo",
    "tts",
    "audio",
    "transcribe",
    "whisper",
    "realtime",
    "live",
    "moderation",
    "ocr",
    "dall-e",
    "aqa",
    "fim",
    "voxtral",
    "codex",
    "banana",
    "computer-use",
)


def _is_chat(resource_id: str, entry: dict[str, Any]) -> bool:
    """Whether a model a key lists can answer a conversation here (``/chat/completions`` or
    Claude's Messages API). Pictures, speech, embeddings and Responses-only models cannot."""
    mid = str(entry.get("id", "")).removeprefix("models/").lower()
    if not mid or any(word in mid for word in _NOT_CHAT):
        return False
    if resource_id == "claude":
        return mid.startswith("claude-")
    if resource_id == "chatgpt":
        # "-pro" models answer only over the Responses API.
        return mid.startswith(("gpt-", "o1", "o3", "o4", "chat")) and "-pro" not in mid
    if resource_id == "gemini-3-pro":
        return mid.startswith(("gemini", "gemma"))
    if resource_id == "mistral":
        capabilities = entry.get("capabilities")
        if isinstance(capabilities, dict) and "completion_chat" in capabilities:
            return capabilities["completion_chat"] is True
    return True


def chat_models(resource_id: str, key: str, **client: Any) -> list[str] | str:
    """Every chat model ``key`` can use at a resource, sorted, or a short error code. This is
    what the person picks from (``linked_resources.models``). Nothing from a conversation is
    sent; the key is never printed or logged."""
    entries = _entries(resource_id, key, client)
    if isinstance(entries, str):
        return entries
    return sorted(
        {str(e["id"]).removeprefix("models/") for e in entries if _is_chat(resource_id, e)}
    )


def _entries(resource_id: str, key: str, client: dict[str, Any]) -> list[dict[str, Any]] | str:
    spec = SPECS[resource_id]
    claude = spec.protocol == "anthropic"
    headers = (
        claude_headers(key) if claude else {**company.HEADERS, "Authorization": f"Bearer {key}"}
    )
    try:
        with net.outbound_client(
            net.Allowlist(company=lambda: spec.base_url),
            timeout=net.Timeout(company.CHECK_TIMEOUT_S),
            **{k: v for k, v in client.items() if v is not None},
        ) as http:
            resp = http.get(
                f"{api_root(spec.base_url)}/models",
                # Anthropic lists 20 models a page unless asked for more; others take no limit.
                params={"limit": 1000} if claude else None,
                headers=headers,
            )
            if resp.status_code in (401, 403):
                return "resource_key_rejected"
            if resp.status_code != 200:
                return "resource_unreachable"
            listed = resp.json().get("data", [])
    except (net.HostNotAllowed, net.HTTPError, ValueError, AttributeError):
        return "resource_unreachable"
    if not isinstance(listed, list):
        return "resource_unreachable"
    return [m for m in listed if isinstance(m, dict) and m.get("id")]


def _listed(
    found: CompanyConfig, headers: dict[str, str], client: dict[str, Any]
) -> list[str] | str:
    """The model names at ``found``'s address (a Claude side's own check)."""
    try:
        with net.outbound_client(
            net.Allowlist(company=lambda: found.base_url),
            timeout=net.Timeout(company.CHECK_TIMEOUT_S),
            **{k: v for k, v in client.items() if v is not None},
        ) as http:
            resp = http.get(
                f"{api_root(found.base_url)}/models", params={"limit": 1000}, headers=headers
            )
            if resp.status_code in (401, 403):
                return "resource_key_rejected"
            if resp.status_code != 200:
                return "resource_unreachable"
            listed = resp.json().get("data", [])
    except (net.HostNotAllowed, net.HTTPError, ValueError, AttributeError):
        return "resource_unreachable"
    return sorted(str(m.get("id")) for m in listed if isinstance(m, dict) and m.get("id"))


def listed_models(resource_id: str, key: str, **client: Any) -> list[str] | str:
    """Every model name ``key`` can use at a resource, sorted (``aios-backend resource
    models``), or a short error code. The key is never printed."""
    entries = _entries(resource_id, key, client)
    if isinstance(entries, str):
        return entries
    # Gemini's OpenAI-compatible list names its models "models/<name>".
    return sorted({str(e["id"]).removeprefix("models/") for e in entries})
