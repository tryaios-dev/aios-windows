"""Everything in the Python code that depends on the operating system, behind one interface.

AIOS ships for Windows only. Other code asks ``current()`` for paths, hardware and the expected
key store, and never checks the OS itself (a test enforces this). Adding an OS later means one
new module here plus its entry in ``_BY_SYS_PLATFORM`` (docs/platforms.md).
"""

import sys
from functools import cache

from aios_common.platforms.base import ChildJob, Hardware, Platform, UnsupportedPlatform
from aios_common.platforms.generic import GenericPlatform
from aios_common.platforms.windows import WindowsPlatform

__all__ = [
    "ChildJob",
    "GenericPlatform",
    "Hardware",
    "Platform",
    "UnsupportedPlatform",
    "WindowsPlatform",
    "current",
    "for_id",
    "require_shipped",
]

# sys.platform -> implementation. Add "darwin" / "linux" here when those ports exist.
_BY_SYS_PLATFORM: dict[str, type[Platform]] = {"win32": WindowsPlatform}
_BY_ID: dict[str, type[Platform]] = {"windows": WindowsPlatform, "generic": GenericPlatform}


@cache
def current() -> Platform:
    """The platform this process runs on; the development fallback on an unshipped OS."""
    return _BY_SYS_PLATFORM.get(sys.platform, GenericPlatform)()


def for_id(platform_id: str) -> Platform:
    """A platform by id (tests, and code that must reason about another OS's layout)."""
    return _BY_ID[platform_id]()


def require_shipped(platform: Platform | None = None) -> Platform:
    """The current platform, or ``UnsupportedPlatform`` if AIOS does not ship for it."""
    chosen = platform or current()
    if not chosen.shipped:
        raise UnsupportedPlatform(f"AIOS does not ship for this operating system ({sys.platform})")
    return chosen
