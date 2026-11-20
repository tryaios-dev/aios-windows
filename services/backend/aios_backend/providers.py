"""The provider router (PR-04): how chat reaches a model. It never talks to an engine itself.

Chat asks the router for an answer; the router picks the provider and sends the request to the
local AI gateway (G-01) on loopback, presenting ``derive(T, "aios/ipc/v1/gateway")``. The gateway
is the only inference endpoint on the device (invariant 1, IPC-02). Two providers:

* ``local``: the engine on this computer, always;
* ``company``: the company's AI server (G-06), only while one is configured (``operator.json`` or
  ``company.json``). Whether a conversation may move there is decided by chat, which asks first
  (PR-03).

The request names its provider in the gateway's optional ``provider`` field.

Model facts (context length, runtime, and how many tokens a text is, G-04) and the prompt each
provider puts first (``prepare``, so the input commitment covers the bytes sent, G-03) come from
the providers directly: they are facts about the model and wording, not answers from it. Only the
local engine counts tokens; for Company, chat estimates.
"""

import json
from collections.abc import Callable, Iterator
from urllib.parse import urlparse

import httpx

from aios_backend.apps.chat.answers import AnswerSource, ModelInfo
from aios_backend.engine import NoModel
from aios_backend.engine.client import Streamed
from aios_backend.engine.launcher import EngineError
from aios_backend.gateway.app import GATEWAY_PURPOSE
from aios_common.handshake import derive

LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost", "testserver"}


class ProviderRouter:
    """An ``AnswerSource`` for chat that answers through the gateway."""

    def __init__(
        self,
        models: AnswerSource,
        gateway_url: str,
        client: Callable[[], httpx.Client] | None = None,
        company: AnswerSource | None = None,
        resource: AnswerSource | None = None,
    ) -> None:
        host = urlparse(gateway_url).hostname
        if host not in LOOPBACK_HOSTS:
            raise ValueError("the gateway is on loopback only (IPC-21)")
        self._sources: dict[str, AnswerSource] = {"local": models}
        if company is not None:
            self._sources["company"] = company
        if resource is not None:
            self._sources["resource"] = resource
        self._url = gateway_url.rstrip("/") + "/v1/chat/completions"
        # A client handed in (tests) belongs to the caller; one made here is closed after use.
        self._shared = client

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        source = self._sources.get(provider)
        return source.model(provider, model_id) if source is not None else None

    def count_tokens(self, provider: str, model_id: str, text: str) -> int | None:
        """The model's own token count, or None (chat then estimates). Only a provider that can
        count (the local engine's tokenizer, G-04) gives one."""
        count = getattr(self._sources.get(provider), "count_tokens", None)
        if not callable(count):
            return None
        result = count(provider, model_id, text)
        return result if isinstance(result, int) else None

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """The messages as the provider will send them, with its own prompt first (G-03)."""
        prepare = getattr(self._sources.get(provider), "prepare", None)
        return list(prepare(provider, messages)) if callable(prepare) else list(messages)

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Streamed:
        """Answer text in chunks; ``usage`` holds the provider's token counts once it is done."""
        if provider not in self._sources:
            raise NoModel
        out = Streamed()
        out._chunks = self._chunks(provider, model_id, messages, out)
        return out

    def _chunks(
        self, provider: str, model_id: str, messages: list[dict[str, str]], out: Streamed
    ) -> Iterator[str]:
        body = {"model": model_id, "messages": messages, "stream": True, "provider": provider}
        headers = {"Authorization": f"Bearer {derive(GATEWAY_PURPOSE)}"}
        client = self._shared() if self._shared else _new_client()
        try:
            with client.stream("POST", self._url, json=body, headers=headers) as resp:
                if resp.status_code == 404:
                    raise NoModel
                if resp.status_code != 200:
                    raise EngineError("engine_failed")
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data == "[DONE]":
                        return
                    event = json.loads(data)
                    if "error" in event:
                        raise EngineError("engine_failed")
                    usage = event.get("usage")
                    if isinstance(usage, dict):
                        prompt, completion = (
                            usage.get("prompt_tokens"),
                            usage.get("completion_tokens"),
                        )
                        if isinstance(prompt, int) and isinstance(completion, int):
                            out.usage = (prompt, completion)
                    choices = event.get("choices") or []
                    text = choices[0].get("delta", {}).get("content") if choices else None
                    if text:
                        yield text
        finally:
            if self._shared is None:
                client.close()


def _new_client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(600.0, connect=5.0), trust_env=False)
