"""This machine's hardware (from the platform layer) and the one model AIOS suggests for it.

Reading the hardware is OS-specific and lives in ``aios_common.platforms``; the suggestion is a
product rule and the same on every OS.

The rule is the "General and chat" column of the Local Model Catalogue v3 recommendations for
Windows PCs (4 Nov 2026). Integrated graphics count as no dedicated GPU (the model shares system
memory either way), and so does a GPU whose driver is missing.

    GPU (GB)  RAM (GB)  model
    24+       64+       Qwen3.8 27B     fits fully on the GPU
    8+        32+       Sage A1.5       mixture of experts: experts in system memory
    8+        16+       Ornith 1.5 9B   fits fully on the GPU
    any       8+        MiniCPM5 2B     runs on the CPU

The first row the machine meets wins, as long as the entry may be installed (a third-party file
needs a passed review, MVP 9.6) and the drive holding the models has room for the file plus
working space. Otherwise the next row is tried. Below 8 GB memory or 10 GB free disk nothing is
suggested and AIOS works without chat.
"""

from collections.abc import Callable, Iterable
from pathlib import Path

from aios_backend.apps.models.catalogue import Entry
from aios_common.platforms import Hardware, current

# Same rules as the UI (apps/ui/src/bridge/sim/catalogue.ts: MINIMUM_PROFILE, recommendFor).
MIN_RAM_GB, MIN_FREE_DISK_GB = 8, 10
WORKING_SPACE_BYTES = 2 * 1024**3
GIB = 1024**3

# (minimum dedicated VRAM in GB, minimum RAM in GB, catalogue entry id), best first.
PROFILES: tuple[tuple[int, int, str], ...] = (
    (24, 64, "qwen3.8-27b-ud-q4_k_m-unsloth-gguf"),
    (8, 32, "sage-a1.5-q4_k_m-mradermacher-gguf"),
    (8, 16, "ornith-1.5-9b-q4_k_m-ornith-gguf"),
    (0, 8, "minicpm5-2b-q4_k_m-openbmb-gguf"),
)

__all__ = ["PROFILES", "Hardware", "detect", "recommend"]


def detect(disk: Path) -> Hardware:
    """``disk``: a folder on the drive models are stored on (created if missing)."""
    return current().hardware(disk)


def recommend(
    ram_gb: int,
    free_disk_gb: int,
    vram_gb: int | None,
    driver_ok: bool,
    entries: Iterable[Entry],
    installable: Callable[[Entry], bool],
) -> Entry | None:
    """The one catalogue entry to suggest for this machine, or None."""
    if ram_gb < MIN_RAM_GB or free_disk_gb < MIN_FREE_DISK_GB:
        return None
    vram = (vram_gb or 0) if driver_ok else 0
    by_id = {e.id: e for e in entries}
    for min_vram, min_ram, entry_id in PROFILES:
        entry = by_id.get(entry_id)
        if entry is None or vram < min_vram or ram_gb < min_ram or not installable(entry):
            continue
        if free_disk_gb * GIB < entry.size_bytes + WORKING_SPACE_BYTES:
            continue
        return entry
    return None
