"""Model files from their origin on Hugging Face (the ``ModelMirror`` seam of the models app).

Each catalogue entry's ``mirror_url`` is the file on Hugging Face at a pinned revision. The
request goes through the network door (``aios_backend.net``), so huggingface.co and the CDN hosts
its downloads redirect to are checked on every hop, certificates come from the OS trust store and
the system proxy applies. Resuming uses an HTTP range request. Nothing here trusts the bytes: the
models app checks size and SHA-256 against the catalogue before the file is installed.
"""

from collections.abc import Iterator
from typing import Any

from aios_backend import net
from aios_backend.apps.models import catalogue

CHUNK = 1024 * 1024
HEADERS = {"User-Agent": "AIOS"}  # no user, machine or account details


class OriginError(Exception):
    """The origin answered, but not with the bytes asked for."""


class HuggingFaceOrigin:
    def __init__(self, allowlist: net.Allowlist | None = None, **client: Any) -> None:
        """``client``: extra arguments for the HTTP client (tests pass a transport)."""
        self._allowlist = allowlist or net.Allowlist()
        self._client = client

    def fetch(self, entry_id: str, url: str, offset: int) -> Iterator[bytes]:
        headers = dict(HEADERS)
        if offset > 0:
            headers["Range"] = f"bytes={offset}-"
        with (
            net.outbound_client(
                self._allowlist, timeout=net.Timeout(30.0, read=60.0), **self._client
            ) as client,
            client.stream("GET", url, headers=headers) as resp,
        ):
            expected = 206 if offset > 0 else 200
            if resp.status_code != expected:
                raise OriginError(f"status_{resp.status_code}")
            yield from resp.iter_bytes(CHUNK)

    def catalogue_version(self) -> str:
        """Models come straight from their origin, so the catalogue in use is the bundled one."""
        return catalogue.version()
