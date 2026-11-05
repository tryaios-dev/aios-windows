"""The ONLY module that imports keyring (FR-30). The OS key store of the current platform.

On a shipped platform the keyring backend must be the one the platform names (Windows: Credential
Manager), so a misconfigured machine can never fall back to a plaintext or third-party store.
"""

from functools import cache

import keyring

from aios_common import platforms

SERVICE = "AIOS"


class KeystoreUnavailable(RuntimeError):
    """The OS key store this platform requires is not the one keyring would use."""


@cache
def _checked() -> None:
    expected = platforms.current().keyring_backend
    if expected is None:
        return  # development fallback: whatever keyring offers
    backend = keyring.get_keyring()
    actual = f"{type(backend).__module__}.{type(backend).__name__}"
    if actual != expected:
        raise KeystoreUnavailable(f"expected key store {expected}, found {actual}")


def get_secret(name: str) -> str | None:
    _checked()
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str) -> None:
    _checked()
    keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> None:
    _checked()
    keyring.delete_password(SERVICE, name)
