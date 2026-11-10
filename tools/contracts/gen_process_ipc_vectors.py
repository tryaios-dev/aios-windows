"""Generate the golden vectors of the Process and IPC Contract v1 (D-02).

    uv run python tools/contracts/gen_process_ipc_vectors.py          # rewrite the files
    uv run python tools/contracts/gen_process_ipc_vectors.py --check  # CI: files are current

Inputs are fixed (no randomness) so the output is byte-stable. Expected values are computed
here with the standard library, independently of aios_common, so the vectors test the code
rather than restate it. Once v1 is FROZEN, a change to an existing vector needs a new contract
version and an ADR; new vectors may only be added.
"""

import base64
import hashlib
import hmac
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "contracts" / "process-ipc" / "v1" / "golden-vectors"

LAUNCH = base64.urlsafe_b64encode(bytes(range(32))).rstrip(b"=").decode()  # 43 chars
LAUNCH_2 = base64.urlsafe_b64encode(bytes(range(255, 223, -1))).rstrip(b"=").decode()
PURPOSES = {
    "gateway": "aios/ipc/v1/gateway",
    "evidence-writer": "aios/ipc/v1/evidence-writer",
    "engine": "aios/ipc/v1/engine",
}


def derive(token: str, purpose_string: str) -> str:
    return hmac.new(
        token.encode("ascii"), purpose_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()


def frame(obj: object) -> str:
    return json.dumps(obj, separators=(", ", ": ")) + "\n"


def handshake_vectors() -> list[dict[str, object]]:
    writer_token = derive(LAUNCH, PURPOSES["evidence-writer"])
    ok = [
        (
            "launch token, port 0 (what Electron main sends)",
            frame({"token": LAUNCH, "api_port": 0}),
            LAUNCH,
            0,
        ),
        ("launch token, port omitted (default 0)", frame({"token": LAUNCH_2}), LAUNCH_2, 0),
        ("launch token, explicit port", frame({"token": LAUNCH, "api_port": 50123}), LAUNCH, 50123),
        (
            "derived token (backend -> evidence writer)",
            frame({"token": writer_token, "api_port": 0}),
            writer_token,
            0,
        ),
        (
            "fields in any order, compact JSON",
            '{"api_port":0,"token":"' + LAUNCH + '"}\n',
            LAUNCH,
            0,
        ),
    ]
    bad = [
        ("empty stdin", ""),
        ("no LF", frame({"token": LAUNCH})[:-1]),
        ("not JSON", "token=" + LAUNCH + "\n"),
        ("JSON array", "[" + json.dumps(LAUNCH) + "]\n"),
        ("token missing", frame({"api_port": 0})),
        ("empty token", frame({"token": ""})),
        ("token 42 chars", frame({"token": LAUNCH[:-1]})),
        ("token 44 chars", frame({"token": LAUNCH + "A"})),
        ("token with standard base64 characters", frame({"token": "+" + LAUNCH[1:]})),
        ("token padded", frame({"token": LAUNCH[:-1] + "="})),
        ("derived token in upper case", frame({"token": writer_token.upper()})),
        ("token not a string", frame({"token": 12345})),
        ("api_port negative", frame({"token": LAUNCH, "api_port": -1})),
        ("api_port above 65535", frame({"token": LAUNCH, "api_port": 65536})),
        ("api_port as string", frame({"token": LAUNCH, "api_port": "0"})),
        ("api_port boolean", frame({"token": LAUNCH, "api_port": True})),
        ("api_port fractional", frame({"token": LAUNCH, "api_port": 1.5})),
        ("unknown field", frame({"token": LAUNCH, "api_port": 0, "debug": True})),
        (
            "larger than 4096 bytes",
            frame({"token": LAUNCH, "api_port": 0})[:-2] + " " * 4096 + "}\n",
        ),
    ]
    vectors: list[dict[str, object]] = [
        {"name": n, "frame": f, "valid": True, "token": t, "api_port": p} for n, f, t, p in ok
    ]
    vectors += [{"name": n, "frame": f, "valid": False} for n, f in bad]
    return vectors


def ready_vectors() -> list[dict[str, object]]:
    return [
        {
            "name": "backend, canonical form",
            "line": 'READY {"api_port": 50123}',
            "valid": True,
            "api_port": 50123,
            "canonical": True,
        },
        {
            "name": "compact JSON",
            "line": 'READY {"api_port":50123}',
            "valid": True,
            "api_port": 50123,
        },
        {
            "name": "with gateway_port",
            "line": 'READY {"api_port": 50123, "gateway_port": 50124}',
            "valid": True,
            "api_port": 50123,
            "gateway_port": 50124,
        },
        {
            "name": "unknown field ignored",
            "line": 'READY {"api_port": 1, "later_field": "x"}',
            "valid": True,
            "api_port": 1,
        },
        {
            "name": "highest port",
            "line": 'READY {"api_port": 65535}',
            "valid": True,
            "api_port": 65535,
        },
        {
            "name": "other stdout line",
            "line": "Uvicorn running on http://127.0.0.1:50123",
            "valid": False,
        },
        {"name": "prefix without space", "line": 'READY{"api_port": 50123}', "valid": False},
        {"name": "lower-case prefix", "line": 'ready {"api_port": 50123}', "valid": False},
        {"name": "api_port missing", "line": 'READY {"gateway_port": 50124}', "valid": False},
        {"name": "api_port 0", "line": 'READY {"api_port": 0}', "valid": False},
        {"name": "api_port above 65535", "line": 'READY {"api_port": 65536}', "valid": False},
        {"name": "api_port as string", "line": 'READY {"api_port": "50123"}', "valid": False},
        {"name": "payload not JSON", "line": "READY 50123", "valid": False},
    ]


def derive_vectors() -> list[dict[str, object]]:
    return [
        {"token": t, "purpose": p, "purpose_string": s, "derived": derive(t, s)}
        for t in (LAUNCH, LAUNCH_2)
        for p, s in PURPOSES.items()
    ]


def files() -> dict[str, str]:
    def dump(doc: dict[str, object]) -> str:
        return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"

    note = "Generated by tools/contracts/gen_process_ipc_vectors.py; do not edit by hand."
    return {
        "handshake-frames.json": dump(
            {"_comment": note, "max_frame_bytes": 4096, "vectors": handshake_vectors()}
        ),
        "ready-lines.json": dump(
            {"_comment": note, "prefix": "READY ", "vectors": ready_vectors()}
        ),
        "derive.json": dump(
            {
                "_comment": note,
                "algorithm": "lowercase_hex(HMAC-SHA256(key=ASCII(token), msg=UTF-8(purpose_string)))",
                "vectors": derive_vectors(),
            }
        ),
    }


def main() -> int:
    check = "--check" in sys.argv
    stale = []
    for name, text in files().items():
        path = OUT / name
        if check:
            if not path.exists() or path.read_text("utf-8") != text:
                stale.append(name)
        else:
            path.write_text(text, "utf-8", newline="\n")
            print(f"wrote {path.relative_to(OUT.parents[3])}")
    if stale:
        print(
            f"golden vectors out of date: {stale}; run tools/contracts/gen_process_ipc_vectors.py"
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
