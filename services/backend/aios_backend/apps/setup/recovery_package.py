"""Recovery Package v1 (contracts/recovery-package/v1/spec.md) and the recovery key format.

Pure functions; no database, no files, no logging. Security-relevant: key material only ever
lives in local variables here and is returned to the caller, never stored or printed.
Errors carry the spec's codes (``R_FORMAT``, ``R_KDF_PARAMS``, ``R_CHECKSUM``, ``R_UNWRAP``,
``R_PAYLOAD``).
"""

import json
import re
import secrets
import uuid
from dataclasses import dataclass
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from aios_common.canonical import b64url, b64url_decode, jcs, tagged_hash, utc_time

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
KEY_BYTES = 20  # 160-bit recovery key
WRITE_KDF = {"memory_kib": 65536, "iterations": 3, "parallelism": 4}  # RFC 9106 second option
KDF_BOUNDS = {"memory_kib": (65536, 1048576), "iterations": (1, 10), "parallelism": (1, 16)}
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
B64 = re.compile(r"[A-Za-z0-9_-]+")


class RecoveryError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Payload:
    db_key: bytes  # 32 bytes
    signing_seed: bytes  # 32 bytes
    stream_id: str


# ------------------------------------------------------------------ recovery key (section 3)
def _base32(value: int, chars: int) -> str:
    return "".join(CROCKFORD[(value >> (5 * (chars - 1 - i))) & 31] for i in range(chars))


def _check_chars(key: bytes) -> str:
    digest = bytes.fromhex(tagged_hash("aios/recovery/v1/key-check", key))
    return _base32(int.from_bytes(digest[:3]) >> 4, 4)  # first 20 bits


def new_recovery_key() -> bytes:
    return secrets.token_bytes(KEY_BYTES)


def format_recovery_key(key: bytes) -> str:
    """36 characters as 9 groups of 4: 32 for the key, 4 checksum characters."""
    text = _base32(int.from_bytes(key), 32) + _check_chars(key)
    return "-".join(text[i : i + 4] for i in range(0, 36, 4))


def parse_recovery_key(text: str) -> bytes:
    """Normalise what the user typed; a wrong checksum is a typing error before any KDF runs."""
    clean = re.sub(r"[\s-]", "", text).upper().translate(str.maketrans("OIL", "011"))
    if len(clean) != 36 or any(c not in CROCKFORD for c in clean):  # also rejects U
        raise RecoveryError("R_CHECKSUM")
    value = 0
    for c in clean[:32]:
        value = (value << 5) | CROCKFORD.index(c)
    key = value.to_bytes(KEY_BYTES)
    if _check_chars(key) != clean[32:]:
        raise RecoveryError("R_CHECKSUM")
    return key


# ------------------------------------------------------------------ keys
def public_key(seed: bytes) -> bytes:
    return (
        Ed25519PrivateKey.from_private_bytes(seed)
        .public_key()
        .public_bytes(Encoding.Raw, PublicFormat.Raw)
    )


def key_id(public_raw: bytes) -> str:
    return tagged_hash("aios/key/v1/ed25519", public_raw)


def _wrap_key(recovery_key: bytes, kdf: dict[str, Any]) -> bytes:
    return Argon2id(
        salt=b64url_decode(kdf["salt"]),
        length=32,
        iterations=kdf["iterations"],
        lanes=kdf["parallelism"],
        memory_cost=kdf["memory_kib"],
    ).derive(recovery_key)


def _aad(header: dict[str, Any]) -> bytes:
    return bytes.fromhex(tagged_hash("aios/recovery/v1/header", jcs(header)))


# ------------------------------------------------------------------ writing (section 4)
def write(
    *, recovery_key: bytes, db_key: bytes, signing_seed: bytes, stream_id: str
) -> tuple[bytes, str]:
    """The ``recovery.pkg`` bytes and its package_id. Fresh salt and nonce on every call."""
    package_id = str(uuid.uuid4())
    header: dict[str, Any] = {
        "format": "aios-recovery-package",
        "v": 1,
        "package_id": package_id,
        "created_at": utc_time(),
        "stream_id": stream_id,
        "signing_key_id": key_id(public_key(signing_seed)),
        "kdf": {
            "alg": "argon2id",
            "version": 19,
            **WRITE_KDF,
            "salt": b64url(secrets.token_bytes(16)),
        },
        "aead": {"alg": "aes-256-gcm", "nonce": b64url(secrets.token_bytes(12))},
    }
    payload = jcs(
        {
            "v": 1,
            "db_key": b64url(db_key),
            "signing_key_seed": b64url(signing_seed),
            "stream_id": stream_id,
        }
    )
    nonce = b64url_decode(header["aead"]["nonce"])
    ciphertext = AESGCM(_wrap_key(recovery_key, header["kdf"])).encrypt(
        nonce, payload, _aad(header)
    )
    return jcs({**header, "ciphertext": b64url(ciphertext)}), package_id


def package_digest(file_bytes: bytes) -> str:
    return tagged_hash("aios/recovery/v1/file", file_bytes)


# ------------------------------------------------------------------ reading (sections 4 and 6)
def _is_str(value: Any, pattern: re.Pattern[str], length: int | None = None) -> bool:
    return (
        isinstance(value, str)
        and pattern.fullmatch(value) is not None
        and (length is None or len(value) == length)
    )


def read(file_bytes: bytes) -> dict[str, Any]:
    """Parse and validate the header before any KDF runs."""
    try:
        pkg = json.loads(file_bytes.decode("utf-8"))
        if not isinstance(pkg, dict) or jcs(pkg) != file_bytes:
            raise RecoveryError("R_FORMAT")
    except (UnicodeDecodeError, ValueError, TypeError) as exc:
        raise RecoveryError("R_FORMAT") from exc

    kdf, aead = pkg.get("kdf"), pkg.get("aead")
    ok = (
        pkg.get("format") == "aios-recovery-package"
        and pkg.get("v") == 1
        and _is_str(pkg.get("package_id"), UUID)
        and isinstance(pkg.get("created_at"), str)
        and _is_str(pkg.get("stream_id"), UUID)
        and _is_str(pkg.get("signing_key_id"), re.compile(r"[0-9a-f]{64}"))
        and isinstance(kdf, dict)
        and kdf.get("alg") == "argon2id"
        and kdf.get("version") == 19
        and _is_str(kdf.get("salt"), B64, 22)
        and isinstance(aead, dict)
        and aead.get("alg") == "aes-256-gcm"
        and _is_str(aead.get("nonce"), B64, 16)
        and _is_str(pkg.get("ciphertext"), B64)
        and len(pkg["ciphertext"]) <= 4096
    )
    if not ok:
        raise RecoveryError("R_FORMAT")
    assert isinstance(kdf, dict)
    for name, (low, high) in KDF_BOUNDS.items():
        value = kdf.get(name)
        if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
            raise RecoveryError("R_KDF_PARAMS")
    return pkg


def unwrap(pkg: dict[str, Any], recovery_key: bytes) -> Payload:
    header = {k: v for k, v in pkg.items() if k != "ciphertext"}
    try:
        plaintext = AESGCM(_wrap_key(recovery_key, pkg["kdf"])).decrypt(
            b64url_decode(pkg["aead"]["nonce"]), b64url_decode(pkg["ciphertext"]), _aad(header)
        )
    except InvalidTag as exc:
        raise RecoveryError("R_UNWRAP") from exc  # wrong key or damaged: one message, by design

    try:
        payload = json.loads(plaintext)
        db_key = b64url_decode(payload["db_key"])
        seed = b64url_decode(payload["signing_key_seed"])
        ok = (
            payload.get("v") == 1
            and len(db_key) == 32
            and len(seed) == 32
            and payload.get("stream_id") == pkg["stream_id"]
            and key_id(public_key(seed)) == pkg["signing_key_id"]
        )
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise RecoveryError("R_PAYLOAD") from exc
    if not ok:
        raise RecoveryError("R_PAYLOAD")
    return Payload(db_key=db_key, signing_seed=seed, stream_id=payload["stream_id"])
