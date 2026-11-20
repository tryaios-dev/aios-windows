"""Linked resources: cloud AI models the person links on the Resources page (DeepSeek V4 first).

A linked resource is a third chat provider, ``resource``, next to ``local`` and ``company``. It is
answered over the same OpenAI-compatible protocol as the Company server (``company.CompanySource``)
but is a separate thing: the Company server stays as it is, and a conversation reaches a linked
resource only when the person moves it there and allows it (invariant 2, PR-03).

What can be linked and where each key lives is in ``aios_backend.linked_config``. Every request
goes through the network door, allowing only that resource's host (``net.ALLOWLIST`` row
``linked-<id>``), with the key read from the OS key store when the request is made (invariant 3).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import time
from collections.abc import Callable
from typing import Any

from aios_backend import company
from aios_backend.company_config import CompanyConfig
from aios_backend.linked_config import PROVIDER, RESOURCES, linked_id, stored_key

SYSTEM_PROMPT = (
    "You are the AIOS assistant, answering through a cloud AI model the user linked. Answer the "
    "user's latest message directly and helpfully. Do not introduce yourself unless asked who "
    "you are."
)


def valid_key(value: str) -> bool:
    return company.valid_key(value)


class LinkedResources(company.CompanySource):
    """The chat ``AnswerSource`` for ``resource``, used by the gateway: the linked resource now,
    with the key the key store holds now. Its error codes start with ``resource_``."""

    provider = PROVIDER
    prefix = "resource"
    system_prompt = SYSTEM_PROMPT

    def __init__(
        self,
        linked: Callable[[], str | None] = linked_id,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        def config() -> CompanyConfig | None:
            found = linked()
            return RESOURCES.get(found) if found else None

        def secret() -> str | None:
            found = linked()
            return stored_key(found) if found else None

        super().__init__(config, secret, clock, **client)


def check(resource_id: str, key: str, **client: Any) -> str | None:
    """Ask the resource whether ``key`` works, before it is stored. None if it does, else a short
    code (``resource_key_rejected``, ``resource_unreachable``, ``resource_model_not_listed``)."""
    found = RESOURCES[resource_id]
    source = company.CompanySource(lambda: found, lambda: key, **client)
    source.prefix = "resource"
    try:
        source._check(found)
    except company.CompanyError as exc:
        return exc.code
    return None
