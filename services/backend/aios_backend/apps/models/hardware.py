"""This machine's hardware (from the platform layer and the engine) as ``fit.py`` needs it.

Reading the hardware is OS-specific and lives in ``aios_common.platforms``; the graphics card's
free memory comes from the engine's GPU build (``--list-devices``), so it is what the engine
itself will see. Choosing the model is ``fit.py``, the same on every OS.
"""

from pathlib import Path

from aios_backend.apps.models.engine import GpuDevice
from aios_backend.apps.models.fit import Machine
from aios_backend.apps.models.models import HardwareProfile
from aios_common.platforms import Hardware, current

GIB = 1024**3

__all__ = ["Hardware", "card", "detect", "machine"]


def detect(disk: Path) -> Hardware:
    """``disk``: a folder on the drive models are stored on (created if missing)."""
    return current().hardware(disk)


def card(devices: list[GpuDevice]) -> tuple[int, bool | None]:
    """(free bytes, built-in graphics) of the device the engine offloads most to: the separate
    card with the most free memory, else built-in graphics. (0, None) with no device."""
    if not devices:
        return 0, None
    separate = [d for d in devices if not d.integrated]
    best = max(separate or devices, key=lambda d: d.free_bytes)
    return best.free_bytes, bool(best.integrated) if best.integrated is not None else None


def machine(row: HardwareProfile) -> Machine:
    """The saved profile as fit.py's input. Built-in graphics share system memory, so they count
    as no card. A card the engine's GPU build did not list (no working driver, safe mode) has
    no free memory recorded, so it counts as no card too."""
    on_card = 0 if row.card_integrated else row.card_free_bytes or 0
    return Machine(
        ram_gb=row.ram_gb,
        usable_ram_bytes=row.usable_ram_bytes or row.ram_gb * GIB,
        free_disk_gb=row.free_disk_gb,
        # Two threads a core when the OS does not say (most laptops); a VM often has one.
        cores=row.physical_cores or max(1, row.cores // 2),
        memory_gbs=row.memory_bandwidth_gbs,
        card_free_bytes=on_card,
        card_gbs=row.gpu_bandwidth_gbs,
    )
