"""Process and IPC Contract v1 golden vectors against the schemas and aios_common (D-02)."""

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from aios_common import handshake
from aios_common.handshake import HandshakeError, parse_frame

CONTRACT = Path(__file__).resolve().parents[4] / "contracts" / "process-ipc" / "v1"
VECTORS = CONTRACT / "golden-vectors"


def load(name: str) -> Any:
    return json.loads((VECTORS / name).read_text("utf-8"))


def schema(name: str) -> Draft202012Validator:
    doc = json.loads((CONTRACT / name).read_text("utf-8"))
    Draft202012Validator.check_schema(doc)
    return Draft202012Validator(doc)


FRAMES = load("handshake-frames.json")["vectors"]
READY = load("ready-lines.json")["vectors"]
DERIVE = load("derive.json")["vectors"]


def _schema_accepts_frame(raw: str) -> bool:
    if len(raw.encode()) > 4096 or not raw.endswith("\n"):
        return False
    try:
        obj = json.loads(raw[:-1])
    except ValueError:
        return False
    return schema("token-handshake.schema.json").is_valid(obj)


@pytest.mark.parametrize("v", FRAMES, ids=[v["name"] for v in FRAMES])
def test_handshake_frame_vector(v: dict[str, Any]) -> None:
    assert _schema_accepts_frame(v["frame"]) == v["valid"], "vector disagrees with the schema"
    raw = v["frame"].encode()
    if v["valid"]:
        assert parse_frame(raw) == (v["token"].encode(), v["api_port"])
    else:
        with pytest.raises(HandshakeError):
            parse_frame(raw)


@pytest.mark.parametrize("v", READY, ids=[v["name"] for v in READY])
def test_ready_line_vector_matches_schema(v: dict[str, Any]) -> None:
    line: str = v["line"]
    ok = False
    if line.startswith("READY "):
        try:
            ok = schema("ready-line.schema.json").is_valid(json.loads(line[6:]))
        except ValueError:
            ok = False
    assert ok == v["valid"]


@pytest.mark.parametrize("v", DERIVE, ids=[f"{v['purpose']}-{v['token'][:6]}" for v in DERIVE])
def test_derive_vector(v: dict[str, Any]) -> None:
    handshake.set_token_for_tests(v["token"])
    assert handshake.derive(v["purpose_string"]) == v["derived"]
    assert parse_frame(json.dumps({"token": v["derived"]}).encode() + b"\n")  # writer accepts it
