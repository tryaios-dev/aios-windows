"""Windows 10 and 11: the platform AIOS ships for.

Data in %LOCALAPPDATA%\\AIOS, keys in Windows Credential Manager, hardware from the registry and
the Win32 API. Nothing here leaves the machine.
"""

import ctypes
import math
import os
import platform
import shutil
import sys
from pathlib import Path

from aios_common.platforms.base import ChildJob, Hardware, Platform

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
    exe_suffix = ".exe"
    orphan_parent_pid = None  # Windows does not re-parent: an orphan's parent is gone

    def data_dir(self) -> Path:
        base = os.environ.get("LOCALAPPDATA")
        if not base:
            base = str(Path.home() / "AppData" / "Local")
        return Path(base) / "AIOS"

    def operator_dir(self) -> Path:
        base = os.environ.get("ProgramData")
        if not base:
            base = str(Path(os.environ.get("SystemDrive", "C:") + "\\") / "ProgramData")
        return Path(base) / "AIOS"

    def child_env(self, bin_dir: Path, temp_dir: Path) -> dict[str, str]:
        root = os.environ["SystemRoot"]
        return {
            "SystemRoot": root,
            "PATH": f"{bin_dir};{root}\\System32",
            "TEMP": str(temp_dir),
            "TMP": str(temp_dir),
        }

    def kill_on_close_job(self) -> ChildJob:
        from aios_common.platforms.windows_job import KillOnCloseJob

        return KillOnCloseJob()

    def hardware(self, disk: Path) -> Hardware:
        disk.mkdir(parents=True, exist_ok=True)
        gpu_name, vram_gb, driver_ok = _gpu()
        return Hardware(
            cpu=_cpu_name(),
            cores=os.cpu_count() or 1,
            ram_gb=ram_gb(_installed_kib(), _usable_bytes()),
            gpu_name=gpu_name,
            vram_gb=vram_gb,
            gpu_driver_ok=driver_ok,
            free_disk_gb=shutil.disk_usage(disk).free // GIB,
            os=_os_name(),
        )


# The helpers below run on Windows only; `sys.platform` checks keep mypy and other OSes happy.
def ram_gb(installed_kib: int | None, usable_bytes: int) -> int:
    """The memory in the computer, in GB, as Task Manager and the box say ("8 GB").

    Windows can use a little less than is installed: the integrated graphics and the firmware
    keep some for themselves, so an 8 GB laptop often shows "7.4 GB usable". The usable figure
    would put that laptop under the 8 GB minimum, so the installed memory counts. If Windows
    cannot say how much is installed, the usable memory is rounded up to the next whole GB.
    """
    if installed_kib:
        return round(installed_kib * 1024 / GIB)
    return math.ceil(usable_bytes / GIB)


def _installed_kib() -> int | None:
    """Installed memory in KiB, from the firmware's memory table; None if Windows cannot say."""
    if sys.platform != "win32":
        return None
    kib = ctypes.c_ulonglong(0)
    if ctypes.windll.kernel32.GetPhysicallyInstalledSystemMemory(ctypes.byref(kib)):
        return int(kib.value)
    return None


def _usable_bytes() -> int:
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
