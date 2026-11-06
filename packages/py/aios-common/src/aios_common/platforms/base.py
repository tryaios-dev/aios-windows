"""What every operating system must provide, as one interface.

AIOS ships for Windows only. To add another OS later, write one module next to ``windows.py``
that implements :class:`Platform`, register it in ``__init__.py`` and mark it ``shipped`` once
it has passed the release checks (docs/platforms.md). No other backend code changes.
"""

import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


class UnsupportedPlatform(RuntimeError):
    """The shipped app was started on an OS that AIOS does not ship for."""


@dataclass(frozen=True)
class Hardware:
    cpu: str
    cores: int
    ram_gb: int
    gpu_name: str | None
    vram_gb: int | None
    gpu_driver_ok: bool
    free_disk_gb: int
    os: str


class ChildJob:
    """Ties child processes (the engine) to this process's life. Base: does nothing."""

    def assign(self, proc: "subprocess.Popen[bytes]") -> None:
        """Kill ``proc`` when the job is closed or this process ends."""

    def close(self) -> None:
        """Kill every assigned process that is still running."""


class Platform(ABC):
    #: Stable id, also used by the UI and the build ("windows", later e.g. "macos", "linux").
    id: str
    #: True only for an OS AIOS ships for. A non-shipped platform may run dev tools and CI only.
    shipped: bool
    #: ``module.Class`` of the keyring backend the shipped app must use (no plaintext fallback).
    keyring_backend: str | None
    #: Appended to program names, e.g. ``llama-server`` + ``.exe``.
    exe_suffix: str = ""
    #: PID an orphaned child is re-parented to (POSIX: init). None: its parent shows as gone.
    orphan_parent_pid: int | None = 1

    @abstractmethod
    def data_dir(self) -> Path:
        """Per-user folder for AIOS data (database, recovery package, models, logs)."""

    @abstractmethod
    def hardware(self, disk: Path) -> Hardware:
        """This machine's hardware. ``disk``: a folder on the drive models are stored on."""

    @abstractmethod
    def child_env(self, bin_dir: Path, temp_dir: Path) -> dict[str, str]:
        """The whole environment for a child program, built from scratch (IPC-32): only what
        the OS needs to run ``bin_dir``'s program, with temp and config in ``temp_dir``."""

    def kill_on_close_job(self) -> ChildJob:
        """A job whose processes die with this process (IPC-50). Base: none."""
        return ChildJob()
