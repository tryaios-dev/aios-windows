"""Canonical JSON and hashing shared by the frozen contracts (evidence, project and recovery packages).

* ``jcs(obj)``: RFC 8785 canonical JSON bytes. Integers only (the contracts forbid floats).
* ``tagged_hash(tag, data)``: ``SHA-256(UTF-8(tag) || 0x00 || data)``, the domain-separated digest.
* ``b64url`` / ``b64url_decode``: base64url without padding.
* ``utc_time(dt)``: RFC 3339 UTC with milliseconds and ``Z``.
"""

import base64
import hashlib
import json
from datetime import UTC, datetime
from typing import Any

MAX_SAFE_INTEGER = 2**53 - 1


def _check(value: Any) -> None:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return
    if isinstance(value, int):
        if not 0 <= value <= MAX_SAFE_INTEGER:
            raise ValueError("integers must be between 0 and 2^53-1")
        return
    if isinstance(value, list):
        for item in value:
            _check(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError("object keys must be strings")
            _check(item)
        return
    raise TypeError(f"not allowed in canonical JSON: {type(value).__name__}")


def _serialise(value: Any) -> str:
    if isinstance(value, dict):
        keys = sorted(value, key=lambda k: k.encode("utf-16-be"))  # JCS sorts by UTF-16 units
        items = (json.dumps(k, ensure_ascii=False) + ":" + _serialise(value[k]) for k in keys)
        return "{" + ",".join(items) + "}"
    if isinstance(value, list):
        return "[" + ",".join(_serialise(v) for v in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def jcs(value: Any) -> bytes:
    """RFC 8785 bytes of ``value`` (UTF-8, no whitespace, keys sorted)."""
    _check(value)
    return _serialise(value).encode("utf-8")


def tagged_hash(tag: str, data: bytes) -> str:
    return hashlib.sha256(tag.encode("utf-8") + b"\x00" + data).hexdigest()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def utc_time(dt: datetime | None = None) -> str:
    value = (dt or datetime.now(UTC)).astimezone(UTC)
    return value.strftime("%Y-%m-%dT%H:%M:%S.") + f"{value.microsecond // 1000:03d}Z"
