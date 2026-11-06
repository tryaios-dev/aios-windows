"""The platform layer: Windows ships, other OSes run dev tools only, and no OS checks leak out."""

import re
import sys
from pathlib import Path

import pytest

from aios_common import keystore, platforms
from aios_common.platforms import GenericPlatform, UnsupportedPlatform, WindowsPlatform

ROOT = Path(__file__).resolve().parents[4]
PLATFORM_DIR = ROOT / "packages/py/aios-common/src/aios_common/platforms"
# Production Python code (tests and build tools may name an OS).
SOURCES = [
    ROOT / "packages/py/aios-common/src",
    ROOT / "services/backend/aios_backend",
    ROOT / "services/backend/db",
]
OS_SPECIFIC = re.compile(
    r"\bwinreg\b|\bwindll\b|getwindowsversion|sys\.platform|os\.name\b|LOCALAPPDATA|XDG_"
)


def test_only_windows_ships() -> None:
    assert WindowsPlatform.shipped is True
    assert GenericPlatform.shipped is False
    assert platforms.require_shipped(WindowsPlatform()).id == "windows"
    with pytest.raises(UnsupportedPlatform):
        platforms.require_shipped(GenericPlatform())


def test_current_platform_matches_this_machine() -> None:
    expected = "windows" if sys.platform == "win32" else "generic"
    assert platforms.current().id == expected


def test_windows_data_folder_is_under_local_app_data(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert WindowsPlatform().data_dir() == tmp_path / "AIOS"


def test_hardware_of_this_machine(tmp_path: Path) -> None:
    hw = platforms.current().hardware(tmp_path / "models")
    assert hw.cores >= 1 and hw.ram_gb >= 0 and hw.free_disk_gb >= 0 and hw.cpu and hw.os
    if sys.platform == "win32":
        assert hw.os.startswith("Windows") and hw.ram_gb > 0


def test_os_specific_code_lives_only_in_the_platform_layer() -> None:
    offenders = [
        f"{path.relative_to(ROOT)}:{n}"
        for source in SOURCES
        for path in source.rglob("*.py")
        if PLATFORM_DIR not in path.parents
        for n, line in enumerate(path.read_text("utf-8").splitlines(), 1)
        if OS_SPECIFIC.search(line)
    ]
    assert offenders == [], "move OS-specific code into aios_common/platforms: " + ", ".join(
        offenders
    )


def test_shipped_platform_refuses_an_unexpected_key_store(monkeypatch: pytest.MonkeyPatch) -> None:
    class PlaintextKeyring:  # what a misconfigured machine could fall back to
        pass

    monkeypatch.setattr(platforms, "current", WindowsPlatform)
    monkeypatch.setattr(keystore.keyring, "get_keyring", PlaintextKeyring)
    keystore._checked.cache_clear()
    try:
        with pytest.raises(keystore.KeystoreUnavailable):
            keystore.get_secret("db-key")
    finally:
        keystore._checked.cache_clear()
