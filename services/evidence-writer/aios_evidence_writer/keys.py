"""Where the writer gets the evidence signing seed (Ed25519, 32 bytes).

Shipped app: the OS key store (``aios_common.keystore``, entry ``evidence-signing-seed``), the same
entry set-up writes and the Recovery Package wraps. Development and tests: a fixed, non-secret
seed held in memory. The seed never leaves this process except through the key store.
"""

import secrets
from typing import Protocol

from aios_common import keystore

ENTRY = "evidence-signing-seed"
DEV_SEED = bytes.fromhex("5e" * 32)  # same non-secret seed as the backend's dev/test profile


class KeySource(Protocol):
    def seed(self) -> bytes | None: ...
    def replace(self, seed: bytes) -> None: ...


class KeystoreKeys:
    def seed(self) -> bytes | None:
        value = keystore.get_secret(ENTRY)
        return bytes.fromhex(value) if value else None

    def replace(self, seed: bytes) -> None:
        keystore.set_secret(ENTRY, seed.hex())


class MemoryKeys:
    def __init__(self, seed: bytes | None = DEV_SEED) -> None:
        self._seed = seed

    def seed(self) -> bytes | None:
        return self._seed

    def replace(self, seed: bytes) -> None:
        self._seed = seed


def new_seed() -> bytes:
    return secrets.token_bytes(32)
