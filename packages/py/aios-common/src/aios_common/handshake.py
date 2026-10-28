"""Per-launch token handshake over stdin (Process and IPC Contract v1, SR-08).

The token is held only in process memory. It is never written to argv, env, logs or files.
"""

import hashlib
import hmac
import json
import sys
from dataclasses import dataclass

_TOKEN: bytes | None = None


@dataclass(frozen=True)
class Handshake:
    api_port: int


def read_handshake(stream=None) -> Handshake:  # type: ignore[no-untyped-def]
    global _TOKEN
    stream = stream or sys.stdin
    frame = json.loads(stream.readline())
    _TOKEN = frame["token"].encode()
    if stream is sys.stdin:
        sys.stdin.close()
    return Handshake(api_port=int(frame.get("api_port", 0)))


def token() -> bytes:
    if _TOKEN is None:
        raise RuntimeError("launch token not received")
    return _TOKEN


def derive(purpose: str) -> str:
    """Derived token for a child (writer, engine). Distinct per purpose."""
    return hmac.new(token(), purpose.encode(), hashlib.sha256).hexdigest()


def check_bearer(header: str | None, expected: bytes | None = None) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].encode(), expected or token())


def set_token_for_tests(value: str) -> None:
    global _TOKEN
    _TOKEN = value.encode()
