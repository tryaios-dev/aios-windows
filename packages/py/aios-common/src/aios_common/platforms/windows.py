"""Windows 10 and 11: the platform AIOS ships for.

Data in %LOCALAPPDATA%\\AIOS, keys in Windows Credential Manager, hardware from the registry and
the Win32 API. Nothing here leaves the machine.
"""

import ctypes
import os
import platform
import shutil
import sys
from pathlib import Path

from aios_common.platforms.base import Hardware, Platform

GIB = 1024**3
CPU_KEY = r"HARDWARE\DESCRIPTION\System\CentralProcessor\0"
# Display adapters (Windows device class GUID).
GPU_CLASS = r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}"
SKIP_ADAPTERS = ("Basic Display", "Remote")


class _MemoryStatus(ctypes.Structure):
    _fields_ = (
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    )


class WindowsPlatform(Platform):
    id = "windows"
    shipped = True
    keyring_backend = "keyring.backends.Windows.WinVaultKeyring"

    def data_dir(self) -> Path:
        base = os.environ.get("LOCALAPPDATA")
        if not base:
            base = str(Path.home() / "AppData" / "Local")
        return Path(base) / "AIOS"

    def hardware(self, disk: Path) -> Hardware:
        disk.mkdir(parents=True, exist_ok=True)
        gpu_name, vram_gb, driver_ok = _gpu()
        return Hardware(
            cpu=_cpu_name(),
            cores=os.cpu_count() or 1,
            ram_gb=round(_ram_bytes() / GIB),
            gpu_name=gpu_name,
            vram_gb=vram_gb,
            gpu_driver_ok=driver_ok,
            free_disk_gb=shutil.disk_usage(disk).free // GIB,
            os=_os_name(),
        )


# The helpers below run on Windows only; `sys.platform` checks keep mypy and other OSes happy.
def _ram_bytes() -> int:
    if sys.platform != "win32":
        return 0
    status = _MemoryStatus()
    status.dwLength = ctypes.sizeof(_MemoryStatus)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        return int(status.ullTotalPhys)
    return 0


def _cpu_name() -> str:
    if sys.platform == "win32":
        import winreg

        try:
            key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, CPU_KEY)
            return str(winreg.QueryValueEx(key, "ProcessorNameString")[0]).strip()
        except OSError:
            pass
    return platform.processor() or "Unknown processor"


def _gpu() -> tuple[str | None, int | None, bool]:
    """The display adapter with the most memory: name, VRAM in GB, driver present."""
    if sys.platform != "win32":
        return None, None, False
    import winreg

    best: tuple[str | None, int | None, bool] = (None, None, False)
    best_mem = -1
    try:
        cls = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, GPU_CLASS)
    except OSError:
        return best
    for i in range(32):
        try:
            sub = winreg.EnumKey(cls, i)
        except OSError:
            break
        if not sub.isdigit():
            continue
        try:
            key = winreg.OpenKey(cls, sub)
            name = str(winreg.QueryValueEx(key, "DriverDesc")[0])
        except OSError:
            continue
        if any(skip in name for skip in SKIP_ADAPTERS):
            continue
        mem = 0
        for value in ("HardwareInformation.qwMemorySize", "HardwareInformation.MemorySize"):
            try:
                raw = winreg.QueryValueEx(key, value)[0]
                mem = int.from_bytes(raw, "little") if isinstance(raw, bytes) else int(raw)
                break
            except (OSError, ValueError, TypeError):
                continue
        try:
            driver_ok = bool(winreg.QueryValueEx(key, "DriverVersion")[0])
        except OSError:
            driver_ok = False
        if mem > best_mem:
            best_mem, best = mem, (name, round(mem / GIB) if mem else None, driver_ok)
    return best


def _os_name() -> str:
    if sys.platform != "win32":
        return "Windows"
    build = sys.getwindowsversion().build
    return f"{'Windows 11' if build >= 22000 else 'Windows 10'} (build {build})"
