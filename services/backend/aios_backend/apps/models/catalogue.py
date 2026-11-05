"""The model catalogue (contracts/model-catalogue/v1): which models AIOS may install.

Pure logic, no HTTP or database. Until the signed catalogue and its key exist (ticket I-01),
the backend reads ``catalogue_dev.json``: the same entries the UI shows, unsigned, with
placeholder digests. A file is installed only if its size and SHA-256 match an entry.
"""

import hashlib
import json
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

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


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()
