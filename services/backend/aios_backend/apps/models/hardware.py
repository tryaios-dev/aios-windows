"""This machine's hardware (from the platform layer) and the model tier it fits.

Reading the hardware is OS-specific and lives in ``aios_common.platforms``; the tier rule is a
product rule and the same on every OS.
"""

from pathlib import Path

from aios_common.platforms import Hardware, current

# Same rules as the UI (apps/ui/src/bridge/sim/catalogue.ts: MINIMUM_PROFILE, tierFor).
MIN_RAM_GB, MIN_FREE_DISK_GB = 8, 10

__all__ = ["Hardware", "detect", "recommended_tier"]


def detect(disk: Path) -> Hardware:
    """``disk``: a folder on the drive models are stored on (created if missing)."""
    return current().hardware(disk)


def recommended_tier(ram_gb: int, free_disk_gb: int, vram_gb: int | None) -> str | None:
    if ram_gb < MIN_RAM_GB or free_disk_gb < MIN_FREE_DISK_GB:
        return None
    if ram_gb >= 16 or (vram_gb or 0) >= 8:
        return "medium"
    return "small"
