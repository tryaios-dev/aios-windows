"""The Company provider (G-06): answers from the company's AI server.

The server is OpenAI-compatible (llama-server on the lab GPU host, or any server with the same
``/v1/models`` and ``/v1/chat/completions``). An operator switches it on in the operator file
(``config.company_from_file``) and stores its API key with ``aios-backend company-key``. The
gateway calls this module for ``company/...`` models; nothing else does (invariant 1, PR-04).

Every request:

* goes through the network door, which allows only the configured host, on every hop (M-22, P-4);
* carries the API key from the OS key store, read when the request is made (invariant 3). The key
  is never logged, written anywhere else or returned;
* logs only an event name and an error code, never message text (invariant 6).

Whether the server can answer is checked with ``GET /v1/models`` and remembered for a short time,
so the composer and Settings can ask often without loading the server. Moving a conversation to
Company asks the person first; that rule lives in the chat app (invariant 2, PR-03).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import json
import re
import threading
import time
from collections.abc import Callable, Iterator
from typing import Any

from aios_backend import net
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.config import Settings
from aios_backend.engine.client import Streamed, ThinkFilter
from aios_backend.prompting import with_system_prompt
from aios_common import keystore
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

log = get_logger("company")


class CompanyError(Exception):
    """The company server could not answer. ``code`` is a short, content-free reason."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def valid_key(value: str) -> bool:
    return bool(_KEY.fullmatch(value))


def store_key(value: str) -> None:
    """Keep the API key in the OS key store, the only place it may live (invariant 3)."""
    keystore.set_secret(KEY_NAME, value)


def _stored_key() -> str | None:
    return keystore.get_secret(KEY_NAME)


class CompanyModels:
    """The chat ``AnswerSource`` for ``company``, used by the gateway.

    ``secret`` returns the API key (tests pass their own); ``client`` holds extra arguments for the
    HTTP client (tests pass a transport)."""

    def __init__(
        self,
        settings: Settings,
        secret: Callable[[], str | None] = _stored_key,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        self._settings = settings
        self._secret = secret
        self._clock = clock
        self._client = client
        self._lock = threading.Lock()
        self._checked_at: float | None = None
        self._ok = False
        #: Why the last check or answer failed (``company_unreachable``, ``company_key_rejected``,
        #: ...), None after a success. For Settings and the operator's check command.
        self.last_error: str | None = None

    # ---- configuration ----------------------------------------------------------------------

    @property
    def base_url(self) -> str | None:
        """The configured server while the operator flag is on, else None."""
        s = self._settings
        if s.company_ai and s.company_base_url and s.company_model_name:
            return s.company_base_url
        return None

    def _allowlist(self) -> net.Allowlist:
        return net.Allowlist(company=lambda: self.base_url)

    def _key(self) -> str | None:
        try:
            key = self._secret()
        except Exception as exc:  # the key store cannot be used on this machine
            log_event(log, "company_key_unreadable", error_code=type(exc).__name__)
            return None
        return key if key and valid_key(key) else None

    def _headers(self, key: str) -> dict[str, str]:
        return {**HEADERS, "Authorization": f"Bearer {key}"}

    def _failed(self, code: str) -> CompanyError:
        self.last_error = code
        self._checked_at, self._ok = self._clock(), False
        log_event(log, "company_failed", error_code=code)
        return CompanyError(code)

    # ---- AnswerSource -----------------------------------------------------------------------

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        """The company model, or None while Company is off or its server cannot answer."""
        if provider != PROVIDER or self.base_url is None:
            return None
        if not self._reachable():
            return None
        return ModelInfo(
            model_id=self._settings.company_model_name or "",
            context_length=self._settings.company_context_tokens,
            runtime=RUNTIME,
        )

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """The messages exactly as they go to the server: the Company prompt first, once."""
        return with_system_prompt(SYSTEM_PROMPT, messages)

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
            self._checked_at = None
        return self.model(PROVIDER, None)

    def _reachable(self) -> bool:
        with self._lock:
            if self._checked_at is not None:
                ttl = OK_TTL_S if self._ok else FAILED_TTL_S
                if self._clock() - self._checked_at < ttl:
                    return self._ok
            try:
                self._check()
            except CompanyError:
                return False
            if not self._ok:
                log_event(log, "company_reachable")
            self._checked_at, self._ok, self.last_error = self._clock(), True, None
            return True

    def _check(self) -> None:
        base, key = self.base_url, self._key()
        if base is None:
            raise self._failed("company_provider_disabled")
        if key is None:
            raise self._failed("company_key_missing")
        try:
            with net.outbound_client(
                self._allowlist(), timeout=net.Timeout(CHECK_TIMEOUT_S), **self._client
            ) as client:
                resp = client.get(f"{base}/v1/models", headers=self._headers(key))
                if resp.status_code in (401, 403):
                    raise self._failed("company_key_rejected")
                if resp.status_code != 200:
                    raise self._failed("company_unreachable")
                listed = resp.json().get("data", [])
        except CompanyError:
            raise
        except (net.HostNotAllowed, net.HTTPError, ValueError, AttributeError) as exc:
            raise self._failed("company_unreachable") from exc
        names = {m.get("id") for m in listed if isinstance(m, dict)}
        if self._settings.company_model_name not in names:
            raise self._failed("company_model_not_listed")

    # ---- answers ------------------------------------------------------------------------------

    def _answer(
        self, provider: str, messages: list[dict[str, str]], out: Streamed
    ) -> Iterator[str]:
        base = self.base_url
        if provider != PROVIDER or base is None:
            raise self._failed("company_provider_disabled")
        key = self._key()
        if key is None:
            raise self._failed("company_key_missing")
        body = {
            "model": self._settings.company_model_name,
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},  # a final chunk with the token counts
        }
        think = ThinkFilter()
        try:
            with (
                net.outbound_client(
                    self._allowlist(),
                    timeout=net.Timeout(ANSWER_TIMEOUT_S, connect=CHECK_TIMEOUT_S),
                    **self._client,
                ) as client,
                client.stream(
                    "POST", f"{base}/v1/chat/completions", json=body, headers=self._headers(key)
                ) as resp,
            ):
                if resp.status_code in (401, 403):
                    raise self._failed("company_key_rejected")
                if resp.status_code != 200:
                    raise self._failed("company_unreachable")
                for event in _events(resp.iter_lines()):
                    if "error" in event:
                        raise self._failed("company_answer_failed")
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
            raise self._failed("company_unreachable") from exc


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
