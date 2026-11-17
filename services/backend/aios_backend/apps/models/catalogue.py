"""The model catalogue (contracts/model-catalogue/v1): which models AIOS may install.

Pure logic, no HTTP or database. Until the signed catalogue and its key exist (ticket I-01),
the backend reads ``catalogue_dev.json``: the same entries the UI shows, unsigned, with the real
size and SHA-256 of each file (the mirror host is still a placeholder). A file is installed only
if its size and SHA-256 match an entry, and a third-party entry only with a passed deviation
review.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from aios_common.canonical import b64url_decode, jcs, tagged_hash

DEV_CATALOGUE = Path(__file__).with_name("catalogue_dev.json")
CHUNK = 1024 * 1024


@dataclass(frozen=True)
class Entry:
    id: str
    name: str
    tier: str
    upstream_model: str
    upstream_revision: str
    source_weight_digest: str | None
    conversion_tool: str
    conversion_version: str
    quantisation_method: str
    artifact_digest: str
    size_bytes: int
    file_name: str
    licence: str
    licence_reference: str
    publisher: str
    pipeline: str
    deviation_review: dict[str, str] | None
    context_length: int
    min_ram_gb: int
    min_vram_gb: int
    mirror_url: str
    description: str


def _entry(raw: dict[str, Any]) -> Entry:
    art = raw["artefact"]
    return Entry(
        id=raw["id"],
        name=raw["display_name"],
        tier=raw["tier"],
        upstream_model=raw["upstream"]["repo"],
        upstream_revision=raw["upstream"]["revision"],
        source_weight_digest=raw["source_weights_digest"],
        conversion_tool=raw["conversion"]["tool"],
        conversion_version=raw["conversion"]["version"],
        quantisation_method=raw["quantisation"]["method"],
        artifact_digest=art["sha256"],
        size_bytes=art["size_bytes"],
        file_name=art["filename"],
        licence=raw["licence"]["spdx"],
        licence_reference=raw["licence"]["reference"],
        publisher=raw["publisher"],
        pipeline=raw["pipeline"],
        deviation_review=raw.get("deviation_review"),
        context_length=raw["context_length"],
        min_ram_gb=raw["min_ram_gb"],
        min_vram_gb=raw.get("min_vram_gb", 0),
        mirror_url=art["mirror_url"],
        description=raw.get("description", ""),
    )


@cache
def _load(path: Path) -> tuple[str, tuple[Entry, ...]]:
    data = json.loads(path.read_text("utf-8"))
    if data.get("catalogue_version") != 1:
        raise ValueError("catalogue_version")
    return data["issued_at"], tuple(_entry(e) for e in data["entries"])


def entries() -> tuple[Entry, ...]:
    return _load(DEV_CATALOGUE)[1]


def version() -> str:
    """The issue date of the catalogue in use, shown as its version."""
    return _load(DEV_CATALOGUE)[0][:10]


def find(entry_id: str) -> Entry | None:
    return next((e for e in entries() if e.id == entry_id), None)


def installable(entry: Entry) -> bool:
    """Own-pipeline entries always; third-party ones only with a complete, passed deviation
    review (contract model-catalogue/v1 section 6, C_REVIEW; AC-02)."""
    if entry.pipeline == "own":
        return True
    review = entry.deviation_review or {}
    return (
        bool(str(review.get("reviewer") or "").strip())
        and bool(review.get("date"))
        and review.get("quality_threshold_result") == "pass"
    )


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ signed catalogue (section 5, 6)
SIGNATURE_TAG = "aios/model-catalogue/v1"
_KEY_ID = re.compile(r"[0-9a-f]{64}")


class CatalogueRejected(Exception):
    """A catalogue refused by section 6; ``code`` is C_SIG, C_UNKNOWN_KEY, C_FORMAT or C_ROLLBACK."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def verify_signed(
    file_bytes: bytes,
    sig_bytes: bytes,
    trusted_keys: dict[str, bytes],
    last_issued_at: str | None,
) -> tuple[str, tuple[Entry, ...]]:
    """Section 6 steps 1 to 3, in that order: the signature over the exact bytes received, before
    any parsing (C_SIG, C_UNKNOWN_KEY); canonical form and version (C_FORMAT); no rollback
    (C_ROLLBACK). ``trusted_keys``: key_id -> raw Ed25519 public key, pinned in the build.
    Returns (issued_at, entries) of an accepted catalogue."""
    try:
        sig = json.loads(sig_bytes)
        if not isinstance(sig, dict) or sig.get("alg") != "ed25519":
            raise ValueError("alg")
        key_id, signature = str(sig["key_id"]), b64url_decode(str(sig["sig"]))
    except (ValueError, KeyError, TypeError) as exc:
        raise CatalogueRejected("C_SIG") from exc
    if not _KEY_ID.fullmatch(key_id) or key_id not in trusted_keys:
        raise CatalogueRejected("C_UNKNOWN_KEY")
    public_key = trusted_keys[key_id]
    if tagged_hash("aios/key/v1/ed25519", public_key) != key_id:
        raise CatalogueRejected("C_UNKNOWN_KEY")  # a pinned id that does not name its key
    digest = bytes.fromhex(tagged_hash(SIGNATURE_TAG, file_bytes))
    try:
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, digest)
    except (InvalidSignature, ValueError) as exc:
        raise CatalogueRejected("C_SIG") from exc
    try:
        data = json.loads(file_bytes)
        if jcs(data) != file_bytes or data.get("catalogue_version") != 1:
            raise ValueError("format")
        issued_at = str(data["issued_at"])
        found = tuple(_entry(e) for e in data["entries"])
    except (ValueError, KeyError, TypeError) as exc:
        raise CatalogueRejected("C_FORMAT") from exc
    if last_issued_at is not None and issued_at <= last_issued_at:
        raise CatalogueRejected("C_ROLLBACK")
    return issued_at, found
