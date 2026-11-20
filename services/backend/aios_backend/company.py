"""The Company provider (G-06): answers from an OpenAI-compatible server the operator configures.

The server can be the lab GPU host (llama-server) or a hosted API such as DeepSeek: anything that
serves ``/models`` and ``/chat/completions`` the OpenAI way. Where it is comes from
``operator.json`` or ``company.json`` (``aios_backend.company_config``); its API key lives only in
the OS key store and is stored with ``aios-backend company set`` or ``company key``. The gateway
calls this module for ``company`` requests; nothing else does (invariant 1, PR-04).

Every request:

* goes through the network door, which allows only the configured host, on every hop (M-22, P-4);
* carries the API key from the OS key store, read when the request is made (invariant 3). The key
  is never logged, written anywhere else or returned;
* logs only an event name and an error code, never message text (invariant 6).

Whether the server can answer is checked with ``GET /models`` and remembered for a short time, so
the composer and Settings can ask often without loading the server. Moving a conversation to
Company asks the person first; that rule lives in the chat app (invariant 2, PR-03).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
import re
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

from aios_backend import net
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.company_config import (
    DEEPSEEK_MODEL,
    DEEPSEEK_URL,
    DEFAULT_CONTEXT,
    FILE_NAME,
    CompanyConfig,
    api_root,
    current,
    load_config,
    save_config,
    server_url,
    valid_model_name,
    valid_url,
)
from aios_backend.config import Settings
from aios_backend.engine.client import Streamed, ThinkFilter
from aios_backend.engine.launcher import EngineError
from aios_backend.prompting import with_system_prompt
from aios_common.keystore import delete_secret, get_secret, set_secret
from aios_common.logging import get_logger, log_event

PROVIDER = "company"
RUNTIME = "company"
KEY_NAME = "company-api-key"  # the OS key store entry (service "AIOS") that holds the API key
OK_TTL_S = 30.0  # a server that answered is not asked again for this long
FAILED_TTL_S = 5.0  # one that did not is asked again soon, so a fixed server shows up quickly
CHECK_TIMEOUT_S = 10.0
ANSWER_TIMEOUT_S = 600.0  # between two pieces of a long answer
HEADERS = {"User-Agent": "AIOS"}  # no user, machine or account details
_KEY = re.compile(r"[\x21-\x7e]{16,512}")  # printable, no spaces: what a bearer token can hold
# Sent before every Company conversation (the chat app reserves room for it). It must not claim
# the answer comes from this computer.
SYSTEM_PROMPT = (
    "You are the AIOS assistant, answering from your organisation's AI server. Answer the "
    "user's latest message directly and helpfully. Do not introduce yourself unless asked who "
    "you are."
)

# The CLI reads and writes the configuration, and stores and removes the key, through this module.
__all__ = [
    "DEEPSEEK_MODEL",
    "DEEPSEEK_URL",
    "DEFAULT_CONTEXT",
    "FILE_NAME",
    "CompanyConfig",
    "delete_secret",
    "load_config",
    "save_config",
    "server_url",
    "set_secret",
    "valid_model_name",
    "valid_url",
]

log = get_logger("company")


class CompanyError(EngineError):
    """The company server could not answer. ``code`` is a short, content-free reason."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def valid_key(value: str) -> bool:
    return bool(_KEY.fullmatch(value))


def store_key(value: str) -> None:
    """Keep the API key in the OS key store, the only place it may live (invariant 3)."""
    set_secret(KEY_NAME, value)


def _stored_key() -> str | None:
    return get_secret(KEY_NAME)


def configured(settings: Settings) -> CompanyConfig | None:
    """The server ``settings`` point at now: ``company.json`` as it is now while the backend
    follows that file, else what ``operator.json`` said at start. None while Company is off."""
    if settings.company_file is not None:
        return current(settings.company_file)
    if settings.company_ai and settings.company_base_url and settings.company_model_name:
        return CompanyConfig(
            base_url=settings.company_base_url,
            model_name=settings.company_model_name,
            context_length=settings.company_context_tokens,
        )
    return None


class CompanySource:
    """The chat ``AnswerSource`` for ``company``, used by the gateway.

    A subclass can serve another provider over the same OpenAI-compatible protocol (a linked
    resource, ``aios_backend.linked``): it sets ``provider``, ``prefix`` (of its error codes) and
    ``system_prompt``.

    ``config`` returns the server to use now (None: Company is off); ``secret`` returns the API
    key (tests pass their own); ``client`` holds extra arguments for the HTTP client (tests pass a
    transport)."""

    provider = PROVIDER
    prefix = "company"
    system_prompt = SYSTEM_PROMPT

    def __init__(
        self,
        config: Callable[[], CompanyConfig | None],
        secret: Callable[[], str | None] = _stored_key,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        self._config = config
        self._secret = secret
        self._clock = clock
        self._client = {k: v for k, v in client.items() if v is not None}
        self._lock = threading.Lock()
        # (the server checked, when, whether it answered): a new server is checked at once.
        self._checked: tuple[CompanyConfig, float, bool] | None = None
        #: Why the last check or answer failed (``company_unreachable``, ``company_key_rejected``,
        #: ...), None after a success. For Settings and the operator's check command.
        self.last_error: str | None = None

    # ---- configuration ----------------------------------------------------------------------

    @property
    def base_url(self) -> str | None:
        """The configured server's address while Company is on, else None."""
        found = self._config()
        return found.base_url if found else None

    def _key(self) -> str | None:
        try:
            key = self._secret()
        except Exception as exc:  # the key store cannot be used on this machine
            log_event(
                get_logger(self.prefix),
                f"{self.prefix}_key_unreadable",
                error_code=type(exc).__name__,
            )
            return None
        key = key.strip() if key else None
        return key if key and valid_key(key) else None

    def _headers(self, key: str) -> dict[str, str]:
        return {**HEADERS, "Authorization": f"Bearer {key}"}

    def _failed(self, reason: str, found: CompanyConfig | None = None) -> CompanyError:
        code = f"{self.prefix}_{reason}"
        self.last_error = code
        if found is not None:
            self._checked = (found, self._clock(), False)
        log_event(get_logger(self.prefix), f"{self.prefix}_failed", error_code=code)
        return CompanyError(code)

    # ---- AnswerSource -----------------------------------------------------------------------

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        """The company model, or None while Company is off or its server cannot answer."""
        found = self._config()
        if provider != self.provider or found is None:
            return None
        if not self._reachable(found):
            return None
        return ModelInfo(
            model_id=found.model_name, context_length=found.context_length, runtime=RUNTIME
        )

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """The messages exactly as they go to the server: the Company prompt first, once."""
        return with_system_prompt(self.system_prompt, messages)

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Streamed:
        """Answer text in chunks; ``usage`` holds the server's token counts once it is done.
        Closing it closes the request, so the server stops too (Stop)."""
        out = Streamed()
        out._chunks = self._answer(provider, self.prepare(provider, messages), out)
        return out

    # ---- the check ----------------------------------------------------------------------------

    def recheck(self) -> ModelInfo | None:
        """Ask the server now, whatever was remembered (the operator's check command)."""
        with self._lock:
            self._checked = None
        return self.model(self.provider, None)

    def _reachable(self, found: CompanyConfig) -> bool:
        with self._lock:
            if self._checked is not None and self._checked[0] == found:
                _, at, ok = self._checked
                if self._clock() - at < (OK_TTL_S if ok else FAILED_TTL_S):
                    return ok
            was_ok = self._checked is not None and self._checked[2]
            try:
                self._check(found)
            except CompanyError:
                return False
            if not was_ok:
                log_event(get_logger(self.prefix), f"{self.prefix}_reachable")
            self._checked, self.last_error = (found, self._clock(), True), None
            return True

    def _check(self, found: CompanyConfig) -> None:
        key = self._key()
        if key is None:
            raise self._failed("key_missing", found)
        try:
            with net.outbound_client(
                net.Allowlist(company=lambda: found.base_url),
                timeout=net.Timeout(CHECK_TIMEOUT_S),
                **self._client,
            ) as client:
                resp = client.get(f"{api_root(found.base_url)}/models", headers=self._headers(key))
                if resp.status_code in (401, 403):
                    raise self._failed("key_rejected", found)
                if resp.status_code != 200:
                    raise self._failed("unreachable", found)
                listed = resp.json().get("data", [])
        except CompanyError:
            raise
        except (net.HostNotAllowed, net.HTTPError, ValueError, AttributeError) as exc:
            raise self._failed("unreachable", found) from exc
        names = {m.get("id") for m in listed if isinstance(m, dict)}
        if found.model_name not in names:
            raise self._failed("model_not_listed", found)

    # ---- answers ------------------------------------------------------------------------------

    def _answer(
        self, provider: str, messages: list[dict[str, str]], out: Streamed
    ) -> Iterator[str]:
        found = self._config()
        if provider != self.provider or found is None:
            raise self._failed("provider_disabled")
        key = self._key()
        if key is None:
            raise self._failed("key_missing", found)
        body = {
            "model": found.model_name,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},  # a final chunk with the token counts
        }
        think = ThinkFilter()
        try:
            with (
                net.outbound_client(
                    net.Allowlist(company=lambda: found.base_url),
                    timeout=net.Timeout(ANSWER_TIMEOUT_S, connect=CHECK_TIMEOUT_S),
                    **self._client,
                ) as client,
                client.stream(
                    "POST",
                    f"{api_root(found.base_url)}/chat/completions",
                    json=body,
                    headers=self._headers(key),
                ) as resp,
            ):
                if resp.status_code in (401, 403):
                    raise self._failed("key_rejected", found)
                if resp.status_code != 200:
                    raise self._failed("unreachable", found)
                for event in _events(resp.iter_lines()):
                    if "error" in event:
                        raise self._failed("answer_failed", found)
                    out.usage = _usage(event) or out.usage
                    text = think.feed(_delta(event))
                    if text:
                        yield text
                rest = think.flush()
                if rest:
                    yield rest
        except CompanyError:
            raise
        except (net.HostNotAllowed, net.HTTPError) as exc:
            raise self._failed("unreachable", found) from exc


class CompanyModels(CompanySource):
    """The company side the backend runs with: the server ``settings`` point at, followed live
    while ``company.json`` decides (``configured``)."""

    def __init__(
        self,
        settings: Settings,
        secret: Callable[[], str | None] = _stored_key,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        super().__init__(lambda: configured(settings), secret, clock, **client)


class CompanyProvider(CompanySource):
    """One fixed server (the CLI's check, tests)."""

    def __init__(
        self,
        config: CompanyConfig,
        secret: Callable[[], str | None] = _stored_key,
        transport: net.Transport | None = None,
    ) -> None:
        super().__init__(lambda: config, secret, transport=transport)


class ConfiguredCompany(CompanySource):
    """Whatever ``path`` (a ``company.json``) says now: ``aios-backend company set`` takes effect
    without restarting AIOS."""

    def __init__(
        self,
        path: Path,
        secret: Callable[[], str | None] = _stored_key,
        transport: net.Transport | None = None,
    ) -> None:
        super().__init__(lambda: current(path), secret, transport=transport)


# ------------------------------------------------------------------ the server's event stream
def _events(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    for line in lines:
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
            yield event


def _delta(event: dict[str, Any]) -> str:
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return ""
    delta = choices[0].get("delta")
    content = delta.get("content") if isinstance(delta, dict) else None
    return content if isinstance(content, str) else ""


def _usage(event: dict[str, Any]) -> tuple[int, int] | None:
    usage = event.get("usage")
    if not isinstance(usage, dict):
        return None
    prompt, completion = usage.get("prompt_tokens"), usage.get("completion_tokens")
    if isinstance(prompt, int) and isinstance(completion, int):
        return prompt, completion
    return None
