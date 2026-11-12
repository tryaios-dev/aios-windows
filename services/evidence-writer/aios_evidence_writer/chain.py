"""Evidence Wire Format v1: events, checkpoints and the export manifest signature (pure, no I/O).

Everything hashed or signed is RFC 8785 canonical JSON (``aios_common.canonical.jcs``) and
domain-separated SHA-256 (``tagged_hash``), exactly as contracts/evidence-wire-format/v1/spec.md
says. The independent TypeScript verifier (apps/verifier-cli) must reproduce every byte.
"""

import re
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from aios_common.canonical import b64url, b64url_decode, jcs, tagged_hash

V = 1
ZERO_HASH = "0" * 64
TAG_EVENT = "aios/evidence/v1/event"
TAG_CHECKPOINT = "aios/evidence/v1/checkpoint"
TAG_EXPORT = "aios/evidence/v1/export"
TAG_KEY = "aios/key/v1/ed25519"
TAG_INPUT = "aios/evidence/v1/commit/input"
TAG_OUTPUT = "aios/evidence/v1/commit/output"
CUSTODY = "self-custodied Local, no anchor"

_TYPE = re.compile(r"[a-z][a-z0-9_]{0,63}")
# A body holds ids, enum values, digests, counts and flags only (section 4, P-6). Positions in a
# continuation body are the one nested shape, and the writer builds those itself.
_SAFE_STRING = re.compile(r"[A-Za-z0-9_.:+\-]{0,128}")
_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}")

Json = dict[str, Any]


class BodyRejected(ValueError):
    """An event body held something that is not allowed in the content-free log."""


def public_key(seed: bytes) -> bytes:
    return (
        Ed25519PrivateKey.from_private_bytes(seed)
        .public_key()
        .public_bytes(Encoding.Raw, PublicFormat.Raw)
    )


def key_id(raw_public_key: bytes) -> str:
    return tagged_hash(TAG_KEY, raw_public_key)


def event_hash(event: Json) -> str:
    return tagged_hash(TAG_EVENT, jcs(event))


def check_type(event_type: str) -> None:
    if not _TYPE.fullmatch(event_type):
        raise BodyRejected("event type")


def check_body(body: Json, *, nested: bool = False) -> None:
    for key, value in body.items():
        if not _KEY.fullmatch(key):
            raise BodyRejected("body key")
        if isinstance(value, dict) and not nested:
            check_body(value, nested=True)
        elif isinstance(value, str):
            if not _SAFE_STRING.fullmatch(value):
                raise BodyRejected("body value")
        elif not isinstance(value, bool | int | type(None)):
            raise BodyRejected("body type")


def make_event(
    stream_id: str, epoch: int, seq: int, prev_hash: str, time: str, event_type: str, body: Json
) -> Json:
    check_type(event_type)
    return {
        "v": V,
        "stream_id": stream_id,
        "epoch": epoch,
        "seq": seq,
        "prev_hash": prev_hash,
        "time": time,
        "type": event_type,
        "body": body,
    }


def _sign(seed: bytes, tag: str, obj: Json) -> str:
    digest = bytes.fromhex(tagged_hash(tag, jcs(obj)))
    return b64url(Ed25519PrivateKey.from_private_bytes(seed).sign(digest))


def _verify(raw_public_key: bytes, tag: str, obj: Json, sig: str) -> bool:
    digest = bytes.fromhex(tagged_hash(tag, jcs(obj)))
    try:
        Ed25519PublicKey.from_public_bytes(raw_public_key).verify(b64url_decode(sig), digest)
    except (InvalidSignature, ValueError):
        return False
    return True


def make_checkpoint(
    seed: bytes, stream_id: str, epoch: int, seq: int, tip_hash: str, time: str
) -> Json:
    """``sig`` = Ed25519 over H(checkpoint tag, JCS(checkpoint without sig)) (section 7)."""
    unsigned: Json = {
        "v": V,
        "stream_id": stream_id,
        "epoch": epoch,
        "seq": seq,
        "event_hash": tip_hash,
        "time": time,
        "key_id": key_id(public_key(seed)),
    }
    return {**unsigned, "sig": _sign(seed, TAG_CHECKPOINT, unsigned)}


def verify_checkpoint(checkpoint: Json, raw_public_key: bytes) -> bool:
    unsigned = {k: v for k, v in checkpoint.items() if k != "sig"}
    return _verify(raw_public_key, TAG_CHECKPOINT, unsigned, str(checkpoint.get("sig", "")))


def manifest_digest(manifest: Json) -> str:
    return tagged_hash(TAG_EXPORT, jcs(manifest))


def sign_manifest(seed: bytes, manifest: Json) -> Json:
    """``manifest.sig.json``: the signature of the current epoch's key over the manifest digest."""
    return {
        "v": V,
        "key_id": key_id(public_key(seed)),
        "sig": _sign(seed, TAG_EXPORT, manifest),
    }


def verify_manifest(manifest: Json, signature: Json, raw_public_key: bytes) -> bool:
    return _verify(raw_public_key, TAG_EXPORT, manifest, str(signature.get("sig", "")))


def commitment(tag: str, nonce: bytes, data: bytes) -> str:
    """Hiding commitment (section 8): H(tag, nonce || bytes)."""
    return tagged_hash(tag, nonce + data)
