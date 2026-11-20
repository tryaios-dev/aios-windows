"""Which cloud AI models can be linked, and where their API keys live (no HTTP, no chat imports).

Light on purpose: chat and settings read whether a resource is linked without loading the HTTP
client (``aios_backend.linked`` answers). A resource is linked exactly while its API key is in the
OS key store (invariant 3); the key is never logged, written anywhere else or returned.

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import re

from aios_backend.company_config import DEEPSEEK_URL, CompanyConfig
from aios_common.keystore import delete_secret, get_secret, set_secret
from aios_common.logging import get_logger, log_event

PROVIDER = "resource"
# The resources AIOS can link, by the id the Resources page uses (apps/ui/src/data/resources.ts).
RESOURCES: dict[str, CompanyConfig] = {
    "deepseek-v4": CompanyConfig(
        base_url=DEEPSEEK_URL, model_name="deepseek-v4-pro", context_length=65_536
    ),
}
NAMES = {"deepseek-v4": "DeepSeek V4"}

log = get_logger("linked")
_KEY = re.compile(r"[!-~]{16,512}")  # printable, no spaces: what a bearer token can hold


def valid_key(value: str) -> bool:
    return bool(_KEY.fullmatch(value))


def key_name(resource_id: str) -> str:
    """The OS key store entry (service "AIOS") that holds a resource's API key."""
    return f"resource-{resource_id}-api-key"


def provisioned_name(resource_id: str) -> str:
    """The key store entry for a key an operator stored on this computer
    (``aios-backend resource key``): Link uses it, so the person never handles a key."""
    return f"resource-{resource_id}-provisioned-key"


def store_provisioned(resource_id: str, value: str) -> None:
    set_secret(provisioned_name(resource_id), value)


def provisioned_key(resource_id: str) -> str | None:
    try:
        return get_secret(provisioned_name(resource_id))
    except Exception as exc:  # the key store cannot be used on this machine
        log_event(log, "resource_key_unreadable", error_code=type(exc).__name__)
        return None


def remove_provisioned(resource_id: str) -> None:
    try:
        delete_secret(provisioned_name(resource_id))
    except Exception as exc:  # nothing stored, or the key store cannot be used
        log_event(log, "resource_key_not_removed", error_code=type(exc).__name__)


def store_key(resource_id: str, value: str) -> None:
    set_secret(key_name(resource_id), value)


def remove_key(resource_id: str) -> None:
    try:
        delete_secret(key_name(resource_id))
    except Exception as exc:  # nothing stored, or the key store cannot be used
        log_event(log, "resource_key_not_removed", error_code=type(exc).__name__)


def stored_key(resource_id: str) -> str | None:
    try:
        return get_secret(key_name(resource_id))
    except Exception as exc:  # the key store cannot be used on this machine
        log_event(log, "resource_key_unreadable", error_code=type(exc).__name__)
        return None


def linked_id() -> str | None:
    """The linked resource conversations on ``resource`` use: the first one with a stored key."""
    return next((rid for rid in RESOURCES if stored_key(rid)), None)
