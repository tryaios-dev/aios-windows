"""The provider router (PR-04): how chat reaches a model. It never talks to an engine itself.

Chat asks the router for an answer; the router picks the provider and sends the request to the
local AI gateway (G-01) on loopback, presenting ``derive(T, "aios/ipc/v1/gateway")``. The gateway
is the only inference endpoint on the device (invariant 1, IPC-02). Phase 1a has the local
provider only; the company provider (G-06) is added here, behind its confirmation rules (PR-03).

Model facts (context length, runtime) come from the local model module directly: they are
metadata about installed files, not inference.
"""

import json
from collections.abc import Callable, Iterator
from urllib.parse import urlparse

import httpx

from aios_backend.apps.chat.answers import AnswerSource, ModelInfo
from aios_backend.engine import NoModel
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
    ) -> None:
        host = urlparse(gateway_url).hostname
        if host not in LOOPBACK_HOSTS:
            raise ValueError("the gateway is on loopback only (IPC-21)")
        self._models = models
        self._url = gateway_url.rstrip("/") + "/v1/chat/completions"
        # A client handed in (tests) belongs to the caller; one made here is closed after use.
        self._shared = client

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        if provider != "local":
            return None  # G-06: no company provider in this build
        return self._models.model(provider, model_id)

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        if provider != "local":
            raise NoModel
        body = {"model": model_id, "messages": messages, "stream": True}
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
                    text = event["choices"][0]["delta"].get("content")
                    if text:
                        yield text
        finally:
            if self._shared is None:
                client.close()


def _new_client() -> httpx.Client:
    return httpx.Client(timeout=httpx.Timeout(600.0, connect=5.0), trust_env=False)
