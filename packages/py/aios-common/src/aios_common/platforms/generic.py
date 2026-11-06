"""Development fallback for an OS AIOS does not ship for (Linux CI runners, a developer's Mac).

It lets the dev and test profiles, the CLI and the tests run there. It is never shipped: the
desktop profile refuses to start on it (``require_shipped``). A real port replaces it with its
own module (see docs/platforms.md).
"""

import os
import platform
import shutil
from pathlib import Path

from aios_common.platforms.base import Hardware, Platform

GIB = 1024**3


class GenericPlatform(Platform):
    id = "generic"
    shipped = False
    keyring_backend = None

    def data_dir(self) -> Path:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        return Path(base) / "AIOS"

    def child_env(self, bin_dir: Path, temp_dir: Path) -> dict[str, str]:
        return {
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(temp_dir),
            "XDG_CONFIG_HOME": str(temp_dir),
            "XDG_CACHE_HOME": str(temp_dir),
            "TMPDIR": str(temp_dir),
        }

    def hardware(self, disk: Path) -> Hardware:
        disk.mkdir(parents=True, exist_ok=True)
        sysconf = getattr(os, "sysconf", None)  # POSIX only
        try:
            ram = sysconf("SC_PAGE_SIZE") * sysconf("SC_PHYS_PAGES") if sysconf else 0
        except (ValueError, OSError):
            ram = 0
        return Hardware(
            cpu=platform.processor() or platform.machine() or "Unknown processor",
            cores=os.cpu_count() or 1,
            ram_gb=round(ram / GIB),
            gpu_name=None,
            vram_gb=None,
            gpu_driver_ok=False,
            free_disk_gb=shutil.disk_usage(disk).free // GIB,
            os=f"{platform.system()} {platform.release()}".strip(),
        )
