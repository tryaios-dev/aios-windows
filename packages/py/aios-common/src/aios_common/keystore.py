"""The ONLY module that imports keyring (FR-30). Windows Credential Manager in production."""

import keyring

SERVICE = "AIOS"


def get_secret(name: str) -> str | None:
    return keyring.get_password(SERVICE, name)


def set_secret(name: str, value: str) -> None:
    keyring.set_password(SERVICE, name, value)


def delete_secret(name: str) -> None:
    keyring.delete_password(SERVICE, name)
