"""The Company provider (G-06): answers from an OpenAI-compatible server the operator configures.

The server can be the lab GPU host or a hosted API (for example DeepSeek). This is the gateway's
company side: chat reaches it only as provider router -> gateway -> here (invariant 1, PR-04).

* The address and model name are not secret; they live in ``company.json`` in the data folder,
  written by ``aios-backend company set``. Without a valid file the operator flag is off.
* The API key lives only in the OS key store (``KEY_NAME``) and is read at request time (FR-30).
  It is never in the file, the settings, the evidence or a log.
* Every request goes through the allowlisted outbound client, which allows exactly the configured
  host (SR-01, contracts/network-allowlist/v1 ``company-server``).
* Nothing here logs message text or the key (SR-07); errors are short codes.

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
from collections.abc import Callable, Iterator
from pathlib import Path
from urllib.parse import urlsplit

from aios_backend import net
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.company_config import (
    DEEPSEEK_MODEL,
    DEEPSEEK_URL,
    DEFAULT_CONTEXT,
    FILE_NAME,
    CompanyConfig,
    current,
    load_config,
    save_config,
    valid_url,
)
from aios_backend.engine.launcher import EngineError
from aios_common.keystore import delete_secret, get_secret, set_secret
from aios_common.logging import get_logger, log_event

PROVIDER = "company"
KEY_NAME = "company-api-key"  # the OS key store entry (credential_ref)
SYSTEM_PROMPT = (
    "You are the AIOS assistant. Answer the user's latest message directly and helpfully. "
    "Do not introduce yourself unless asked who you are."
)

# The CLI stores and removes the key, and reads the file, through this module.
__all__ = [
    "DEEPSEEK_MODEL",
    "DEEPSEEK_URL",
    "DEFAULT_CONTEXT",
    "FILE_NAME",
    "CompanyConfig",
    "delete_secret",
    "load_config",
    "save_config",
    "set_secret",
    "valid_url",
]

log = get_logger("company")


def _read_key() -> str | None:
    return get_secret(KEY_NAME)


class CompanyProvider:
    """An ``AnswerSource`` for ``company`` that streams from the configured server."""

    def __init__(
        self,
        config: CompanyConfig,
        secret: Callable[[], str | None] = _read_key,
        transport: net.Transport | None = None,
    ) -> None:
        self._config = config
        self._secret = secret
        self._transport = transport  # tests hand in a fake server
        self._url = config.base_url.rstrip("/") + "/chat/completions"
        self._allowlist = net.Allowlist(company=lambda: config.base_url)

    def _key(self) -> str | None:
        try:
            key = self._secret()
        except Exception:  # the key store is not available
            return None
        return key.strip() if key and key.strip() else None

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        """The configured model while a key is stored; reachability shows on the first answer."""
        if provider != PROVIDER or self._key() is None:
            return None
        host = urlsplit(self._config.base_url).hostname
        return ModelInfo(
            model_id=self._config.model_name,
            context_length=self._config.context_length,
            runtime=f"company {host}",
        )

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """The messages as sent: the AIOS prompt first, once; a note from chat goes after it."""
        if not messages or messages[0].get("role") != "system":
            return [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
        if messages[0]["content"].startswith(SYSTEM_PROMPT):
            return list(messages)
        merged = f"{SYSTEM_PROMPT}\n\n{messages[0]['content']}"
        return [{"role": "system", "content": merged}, *messages[1:]]

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        key = self._key()
        if provider != PROVIDER or key is None:
            log_event(log, "company_refused", error_code="no_key")
            raise EngineError("company_no_key")
        return self._stream(key, self.prepare(provider, messages))

    def _stream(self, key: str, messages: list[dict[str, str]]) -> Iterator[str]:
        body = {"model": self._config.model_name, "messages": messages, "stream": True}
        extra = {"transport": self._transport} if self._transport is not None else {}
        client = net.outbound_client(
            self._allowlist, timeout=net.Timeout(600.0, connect=10.0), **extra
        )
        try:
            with client.stream(
                "POST", self._url, json=body, headers={"Authorization": f"Bearer {key}"}
            ) as resp:
                if resp.status_code != 200:
                    log_event(log, "company_failed", error_code=f"http_{resp.status_code}")
                    raise EngineError(f"company_http_{resp.status_code}")
                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        return
                    event = json.loads(data)
                    if "error" in event:
                        log_event(log, "company_failed", error_code="stream_error")
                        raise EngineError("company_failed")
                    choices = event.get("choices") or []  # the usage chunk has none
                    text = choices[0].get("delta", {}).get("content") if choices else None
                    if text:
                        yield text
        except net.HostNotAllowed as exc:
            raise EngineError("company_host_not_allowed") from exc
        except (net.HTTPError, ValueError) as exc:
            log_event(log, "company_failed", error_code=type(exc).__name__)
            raise EngineError("company_unreachable") from exc
        finally:
            client.close()


class ConfiguredCompany:
    """The gateway's company side: whatever ``company.json`` says now, with the key the key store
    holds now. ``aios-backend company set`` takes effect without restarting AIOS."""

    def __init__(
        self,
        path: Path,
        secret: Callable[[], str | None] = _read_key,
        transport: net.Transport | None = None,
    ) -> None:
        self._path = path
        self._secret = secret
        self._transport = transport
        self._built: tuple[CompanyConfig, CompanyProvider] | None = None

    def _provider(self) -> CompanyProvider | None:
        found = current(self._path)
        if found is None:
            return None
        if self._built is None or self._built[0] != found:
            self._built = (found, CompanyProvider(found, self._secret, self._transport))
        return self._built[1]

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        side = self._provider()
        return side.model(provider, model_id) if side else None

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        side = self._provider()
        return side.prepare(provider, messages) if side else list(messages)

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        side = self._provider()
        if side is None:
            log_event(log, "company_refused", error_code="not_configured")
            raise EngineError("company_not_configured")
        return side.answer(provider, model_id, messages)
