import io
import json

import pytest

from aios_common import handshake
from aios_common.handshake import HandshakeError, parse_frame, read_handshake

LAUNCH = "A" * 21 + "-" + "b" * 20 + "_"  # 43 chars of base64url
DERIVED = "0123456789abcdef" * 4


def frame(**fields: object) -> bytes:
    return json.dumps(fields).encode() + b"\n"


def test_launch_token_and_port_zero() -> None:
    assert parse_frame(frame(token=LAUNCH, api_port=0)) == (LAUNCH.encode(), 0)


def test_derived_token_and_default_port() -> None:
    assert parse_frame(frame(token=DERIVED)) == (DERIVED.encode(), 0)


def test_explicit_port() -> None:
    assert parse_frame(frame(token=LAUNCH, api_port=50123))[1] == 50123


@pytest.mark.parametrize(
    "raw",
    [
        b"",  # stdin closed with nothing on it
        frame(token=LAUNCH)[:-1],  # no LF
        b"not json\n",
        b"[1, 2]\n",
        frame(),
        frame(token=""),  # an empty token would accept "Bearer " (AC-10)
        frame(token=LAUNCH[:-1]),
        frame(token=LAUNCH + "x"),
        frame(token=DERIVED.upper()),
        frame(token=LAUNCH.replace("A", "+")),
        frame(token=LAUNCH, api_port=-1),
        frame(token=LAUNCH, api_port=65536),
        frame(token=LAUNCH, api_port="0"),
        frame(token=LAUNCH, api_port=True),
        frame(token=LAUNCH, extra=1),  # additionalProperties: false
        b'{"token": "' + b"a" * 5000 + b'"}\n',
    ],
)
def test_invalid_frames_are_rejected(raw: bytes) -> None:
    with pytest.raises(HandshakeError) as err:
        parse_frame(raw)
    assert LAUNCH not in str(err.value)


def test_read_handshake_reads_one_line_and_keeps_the_token() -> None:
    stream = io.BytesIO(frame(token=LAUNCH, api_port=0) + b"trailing data is never read\n")
    assert read_handshake(stream).api_port == 0
    assert handshake.token() == LAUNCH.encode()


def test_read_handshake_stops_at_the_size_limit() -> None:
    with pytest.raises(HandshakeError, match="4096"):
        read_handshake(io.BytesIO(b"x" * 10_000))
