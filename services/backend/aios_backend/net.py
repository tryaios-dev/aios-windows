"""The one door to the network (M-22, SR-01; contracts/network-allowlist/v1).

Every outbound request of the backend goes through ``outbound_client``. Before a request is sent,
including every redirect hop, its destination must be on the allowlist:

* the model mirror, the update feed and Hugging Face (the origin of the catalogue's model
  files, with the CDN hosts its downloads redirect to), fixed in the build (``FIXED``);
* the configured company server, only while the operator flag is on, checked at request time
  against the configured value.

Anything else raises ``HostNotAllowed`` and nothing is sent. With a proxy the TCP connection goes
to the proxy, but the check applies to the destination URL. HTTPS only, port 443. Certificates come
from the OS trust store (truststore), so a company CA or a TLS-inspecting proxy is trusted the way
the OS trusts it. Loopback traffic (engine, evidence writer) never uses this client.

In the MVP this is enforced by the application; the operating system enforces it from Phase 1b.
"""

import ssl
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
import truststore

from aios_common.logging import get_logger, log_event

# (id, host, port, purpose, kind). The hostnames are placeholders until B-06 records the real
# ones; this list, Settings > Network and contracts/network-allowlist/v1/allowlist.json agree
# (a test keeps them equal).
ALLOWLIST: list[tuple[str, str, int, str, str]] = [
    (
        "model-mirror",
        "models.example.eu",
        443,
        "Model mirror (downloads you start, catalogue check)",
        "fixed",
    ),
    (
        "update-feed",
        "updates.example.eu",
        443,
        "Signed update feed (at start, at most once a day)",
        "fixed",
    ),
    (
        "model-origin",
        "huggingface.co",
        443,
        "Model downloads from Hugging Face (downloads you start)",
        "fixed",
    ),
    (
        "model-origin-cdn-aws",
        "us.aws.cdn.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-cdn-gcp",
        "us.gcp.cdn.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-xet-bridge",
        "cas-bridge.xethub.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-xet-transfer",
        "transfer.xethub.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-lfs",
        "cdn-lfs.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-lfs-us",
        "cdn-lfs-us-1.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "model-origin-lfs-eu",
        "cdn-lfs-eu-1.hf.co",
        443,
        "Hugging Face file storage (redirect of a model download)",
        "fixed",
    ),
    (
        "company-server",
        "configured",
        443,
        "Company AI server (only while the provider flag is on)",
        "configured",
    ),
]
# Callers set timeouts without importing an HTTP client themselves (layout rule, AC-21).
Timeout = httpx.Timeout

FIXED = frozenset((host, port) for _, host, port, _, kind in ALLOWLIST if kind == "fixed")
MAX_REDIRECTS = 3

log = get_logger("net")


class HostNotAllowed(Exception):
    """A request to a destination outside the allowlist was refused before it was sent."""

    def __init__(self) -> None:
        super().__init__("host_not_allowed")
        self.code = "host_not_allowed"


@dataclass(frozen=True)
class Allowlist:
    fixed: frozenset[tuple[str, int]] = FIXED
    # The company server's base URL while the operator flag is on, else None.
    company: Callable[[], str | None] = lambda: None

    def allows(self, url: str) -> bool:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port or 443
        if parts.scheme != "https" or not host or parts.username or parts.password:
            return False
        if (host, port) in self.fixed:
            return True
        configured = self.company()
        if configured:
            company = urlsplit(configured)
            return (company.hostname or "").lower() == host and (company.port or 443) == port
        return False


def _ssl_context() -> ssl.SSLContext:
    return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)


def outbound_client(allowlist: Allowlist, **kwargs: Any) -> httpx.Client:
    """An httpx client that refuses any destination off the allowlist, on every hop.

    The system proxy settings apply (``trust_env``); the destination is what is checked.
    """

    def check(request: httpx.Request) -> None:
        if not allowlist.allows(str(request.url)):
            log_event(log, "request_refused", error_code="host_not_allowed")
            raise HostNotAllowed()

    hooks = kwargs.pop("event_hooks", {})
    return httpx.Client(
        event_hooks={**hooks, "request": [check, *hooks.get("request", [])]},
        follow_redirects=True,
        max_redirects=MAX_REDIRECTS,
        verify=kwargs.pop("verify", None) or _ssl_context(),
        **kwargs,
    )
