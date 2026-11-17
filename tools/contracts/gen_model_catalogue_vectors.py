"""Generate the golden vectors of Model Catalogue v1 (A-03, contract section 5 and 6).

    uv run python tools/contracts/gen_model_catalogue_vectors.py          # rewrite the files
    uv run python tools/contracts/gen_model_catalogue_vectors.py --check  # CI: files are current

Each vector is a folder with the exact bytes the backend would receive (catalogue.json and
catalogue.json.sig) and expected.json: the trusted key, the last accepted issued_at and the
result, "accept" or the rejection code. The signing key is a fixed TEST key (seed bytes 1..32),
never a release key. Expected values are computed here with the standard library and
`cryptography`, independently of the backend, so the vectors test the code rather than restate it.
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

OUT = (
    Path(__file__).resolve().parents[2] / "contracts" / "model-catalogue" / "v1" / "golden-vectors"
)
TAG = "aios/model-catalogue/v1"
TEST_SEED = bytes(range(1, 33))
OTHER_SEED = bytes(range(33, 65))


def jcs(value: object) -> bytes:
    """RFC 8785 for the values used here (ASCII strings, integers, no floats)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def h(tag: str, data: bytes) -> bytes:
    return hashlib.sha256(tag.encode() + b"\x00" + data).digest()


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def public(seed: bytes) -> bytes:
    return (
        Ed25519PrivateKey.from_private_bytes(seed)
        .public_key()
        .public_bytes(Encoding.Raw, PublicFormat.Raw)
    )


def key_id(seed: bytes) -> str:
    return hashlib.sha256(b"aios/key/v1/ed25519\x00" + public(seed)).hexdigest()


def sign(seed: bytes, data: bytes) -> bytes:
    sig = Ed25519PrivateKey.from_private_bytes(seed).sign(h(TAG, data))
    return jcs({"alg": "ed25519", "key_id": key_id(seed), "sig": b64url(sig)})


def entry(**over: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": "test-model-q4_k_m",
        "tier": "small",
        "display_name": "Test Model",
        "upstream": {"repo": "example/test-model", "revision": "0" * 40},
        "source_weights_digest": "1" * 64,
        "conversion": {"tool": "llama.cpp convert_hf_to_gguf.py", "version": "b12111"},
        "quantisation": {"method": "Q4_K_M"},
        "artefact": {
            "filename": "test-model-q4_k_m.gguf",
            "size_bytes": 1024,
            "sha256": "2" * 64,
            "mirror_url": "https://models.example.org/test-model-q4_k_m.gguf",
        },
        "licence": {"spdx": "Apache-2.0", "reference": "licences/test-model/LICENSE"},
        "publisher": "AIOS",
        "pipeline": "own",
        "deviation_review": None,
        "min_ram_gb": 8,
        "context_length": 4096,
    }
    base.update(over)
    return base


def catalogue(issued_at: str = "2026-11-20T10:00:00.000Z", version: int = 1) -> dict[str, object]:
    return {"catalogue_version": version, "issued_at": issued_at, "entries": [entry()]}


def vectors() -> dict[str, tuple[bytes, bytes, dict[str, object]]]:
    good = jcs(catalogue())
    trusted = {"key_id": key_id(TEST_SEED), "public_key": b64url(public(TEST_SEED))}
    altered = good.replace(b'"size_bytes":1024', b'"size_bytes":1025')
    pretty = json.dumps(catalogue(), indent=2, sort_keys=True).encode()
    older = jcs(catalogue("2026-11-01T10:00:00.000Z"))
    v2 = jcs(catalogue(version=2))

    def exp(result: str, last: str | None = None, note: str = "") -> dict[str, object]:
        return {
            "trusted_keys": [trusted],
            "last_accepted_issued_at": last,
            "result": result,
            "note": note,
        }

    return {
        "valid": (
            good,
            sign(TEST_SEED, good),
            exp(
                "accept",
                "2026-11-01T10:00:00.000Z",
                "Signed by the pinned key, canonical, newer than the last one.",
            ),
        ),
        "altered-byte": (
            altered,
            sign(TEST_SEED, good),
            exp(
                "C_SIG", note="One byte of catalogue.json changed after signing (a tampered size)."
            ),
        ),
        "unknown-key": (
            good,
            sign(OTHER_SEED, good),
            exp("C_UNKNOWN_KEY", note="Validly signed, but by a key the build does not pin."),
        ),
        "not-canonical": (
            pretty,
            sign(TEST_SEED, pretty),
            exp("C_FORMAT", note="Signature is valid, but the bytes are not JCS."),
        ),
        "wrong-version": (
            v2,
            sign(TEST_SEED, v2),
            exp("C_FORMAT", note="catalogue_version is not 1."),
        ),
        "rollback": (
            older,
            sign(TEST_SEED, older),
            exp(
                "C_ROLLBACK", "2026-11-20T10:00:00.000Z", "Older than the last accepted catalogue."
            ),
        ),
    }


def files() -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for name, (cat, sig, expected) in vectors().items():
        out[f"{name}/catalogue.json"] = cat
        out[f"{name}/catalogue.json.sig"] = sig
        out[f"{name}/expected.json"] = json.dumps(expected, indent=2).encode() + b"\n"
    return out


def main(argv: list[str]) -> int:
    wanted = files()
    if "--check" in argv:
        have = (
            {
                str(p.relative_to(OUT)).replace("\\", "/"): p.read_bytes()
                for p in OUT.rglob("*")
                if p.is_file()
            }
            if OUT.exists()
            else {}
        )
        have.pop("README.md", None)
        if have != wanted:
            sys.stderr.write(
                "model catalogue golden vectors are out of date: run `uv run python tools/contracts/gen_model_catalogue_vectors.py`\n"
            )
            return 1
        return 0
    for rel, data in wanted.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
