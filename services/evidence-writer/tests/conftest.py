import itertools
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

from aios_common.canonical import b64url
from aios_evidence_writer import chain
from aios_evidence_writer.keys import DEV_SEED, MemoryKeys
from aios_evidence_writer.store import EvidenceStore, Intent

STREAM = "5f0c3a1e-8b2d-4c6e-9f10-112233445566"
TOKEN = "ab" * 32


def ticking_clock() -> Callable[[], str]:
    counter = itertools.count()
    return lambda: f"2026-11-12T10:{(next(counter) // 60) % 60:02d}:{next(counter) % 60:02d}.000Z"


def genesis(seed: bytes = DEV_SEED, intent_id: str = "i-0") -> Intent:
    public = chain.public_key(seed)
    return Intent(
        intent_id,
        "store_created",
        "2026-11-12T10:00:00.000Z",
        {"signing_key": b64url(public), "key_id": chain.key_id(public), "app_version": "0.1.0"},
    )


def project_event(n: int, project_id: str = "11111111-2222-4333-8444-555555555555") -> Intent:
    return Intent(
        f"i-{n}",
        "project_created",
        "2026-11-12T10:00:01.000Z",
        {"project_id": project_id, "classification": "restricted"},
        project_id=project_id,
    )


@pytest.fixture
def keys() -> MemoryKeys:
    return MemoryKeys()


@pytest.fixture
def store(tmp_path: Path, keys: MemoryKeys) -> Iterator[EvidenceStore]:
    s = EvidenceStore(tmp_path / "evidence.db", keys, clock=ticking_clock())
    s.init_stream(STREAM)
    yield s
    s.close()
