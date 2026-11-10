"""Per-launch token handshake over stdin (Process and IPC Contract v1, SR-08).

The token is held only in process memory. It is never written to argv, env, logs or files.
"""

import hashlib
import hmac
import json
import re
import sys
from dataclasses import dataclass
from typing import IO

_TOKEN: bytes | None = None

MAX_FRAME_BYTES = 4096  # token-handshake.schema.json: object + LF, at most 4096 bytes
# Launch token (base64url of 32 bytes) or a derived token (64 lowercase hex).
_TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{43}|[0-9a-f]{64}")
_FIELDS = frozenset({"token", "api_port"})


class HandshakeError(Exception):
    """The stdin frame is missing or invalid. Messages never contain the frame."""


@dataclass(frozen=True)
class Handshake:
    api_port: int


def parse_frame(raw: bytes) -> tuple[bytes, int]:
    """Validate one frame against token-handshake.schema.json; return (token, api_port)."""
    if len(raw) > MAX_FRAME_BYTES:
        raise HandshakeError("frame larger than 4096 bytes")
    if not raw.endswith(b"\n"):
        raise HandshakeError("frame missing or not terminated by LF")
    try:
        frame = json.loads(raw[:-1].decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise HandshakeError("frame is not one JSON object") from None
    if not isinstance(frame, dict):
        raise HandshakeError("frame is not one JSON object")
    if not frame.keys() <= _FIELDS:
        raise HandshakeError("frame has unknown fields")
    token = frame.get("token")
    if not isinstance(token, str) or not _TOKEN_RE.fullmatch(token):
        raise HandshakeError("token missing or malformed")
    port = frame.get("api_port", 0)
    if type(port) is not int or not 0 <= port <= 65535:
        raise HandshakeError("api_port must be an integer 0-65535")
    return token.encode("ascii"), port


def read_handshake(stream: IO[bytes] | None = None) -> Handshake:
    """Read exactly one frame from stdin (binary), keep the token, close stdin."""
    global _TOKEN
    source = stream or sys.stdin.buffer
    raw = source.readline(MAX_FRAME_BYTES + 1)
    if stream is None:
        sys.stdin.close()
    _TOKEN, port = parse_frame(raw)
    return Handshake(api_port=port)


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
