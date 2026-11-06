"""What every operating system must provide, as one interface.

AIOS ships for Windows only. To add another OS later, write one module next to ``windows.py``
that implements :class:`Platform`, register it in ``__init__.py`` and mark it ``shipped`` once
it has passed the release checks (docs/platforms.md). No other backend code changes.
"""

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


class Platform(ABC):
    #: Stable id, also used by the UI and the build ("windows", later e.g. "macos", "linux").
    id: str
    #: True only for an OS AIOS ships for. A non-shipped platform may run dev tools and CI only.
    shipped: bool
    #: ``module.Class`` of the keyring backend the shipped app must use (no plaintext fallback).
    keyring_backend: str | None

    @abstractmethod
    def data_dir(self) -> Path:
        """Per-user folder for AIOS data (database, recovery package, models, logs)."""

    @abstractmethod
    def hardware(self, disk: Path) -> Hardware:
        """This machine's hardware. ``disk``: a folder on the drive models are stored on."""
