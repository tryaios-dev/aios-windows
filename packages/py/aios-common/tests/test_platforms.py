"""The platform layer: Windows ships, other OSes run dev tools only, and no OS checks leak out."""

import re
import sys
from pathlib import Path

import pytest

from aios_common import keystore, platforms
from aios_common.platforms import GenericPlatform, UnsupportedPlatform, WindowsPlatform
from aios_common.platforms.windows import GIB, ram_gb

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


def test_windows_operator_folder_is_machine_wide(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """G-06: settings an operator sets for every user (the Company AI server) live outside the
    per-user data folder, in the machine-wide program-data folder."""
    monkeypatch.setenv("ProgramData", str(tmp_path))
    assert WindowsPlatform().operator_dir() == tmp_path / "AIOS"


def test_generic_operator_folder_is_the_config_home(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    assert GenericPlatform().operator_dir() == tmp_path / "AIOS"


def test_hardware_of_this_machine(tmp_path: Path) -> None:
    hw = platforms.current().hardware(tmp_path / "models")
    assert hw.cores >= 1 and hw.ram_gb >= 0 and hw.free_disk_gb >= 0 and hw.cpu and hw.os
    if sys.platform == "win32":
        assert hw.os.startswith("Windows") and hw.ram_gb > 0


@pytest.mark.parametrize(
    ("installed_gib", "usable_gib", "expected"),
    [
        (8, 7.4, 8),  # 8 GB laptop, graphics take a share: still 8 GB (test findings, issue 2)
        (8, 6.0, 8),  # 2 GB kept for the graphics
        (16, 15.8, 16),
        (20, 19.7, 20),
        (4, 3.6, 4),  # still under the 8 GB minimum
        (None, 7.4, 8),  # Windows cannot say what is installed: usable, rounded up
        (None, 3.6, 4),
    ],
)
def test_memory_is_what_is_installed_not_what_windows_can_use(
    installed_gib: int | None, usable_gib: float, expected: int
) -> None:
    installed_kib = installed_gib * 1024 * 1024 if installed_gib else None
    assert ram_gb(installed_kib, int(usable_gib * GIB)) == expected


@pytest.mark.skipif(sys.platform != "win32", reason="reads this Windows machine")
def test_installed_memory_is_at_least_the_usable_memory() -> None:
    from aios_common.platforms import windows

    usable = windows._usable_bytes()
    assert usable > 0
    assert windows.ram_gb(windows._installed_kib(), usable) >= usable // GIB


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
