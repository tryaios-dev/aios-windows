"""Orphan clean-up at start-up (IPC-52, AC-09 "verified after a forced crash")."""

import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest

from aios_backend.engine.launcher import EXE
from aios_backend.engine.orphans import is_orphan, kill_orphans


class FakeProc:
    def __init__(self, exe: Path, parent: object | None, name: str = EXE) -> None:
        self._exe, self._parent, self._name = exe, parent, name
        self.killed = False

    def name(self) -> str:
        return self._name

    def exe(self) -> str:
        return str(self._exe)

    def parent(self) -> object | None:
        return self._parent

    def kill(self) -> None:
        self.killed = True


class FakeParent:
    def __init__(self, pid: int) -> None:
        self.pid = pid


def test_only_engines_from_this_installation_without_a_parent_are_orphans(tmp_path: Path) -> None:
    root = tmp_path / "llama"
    mine = root / "cpu" / EXE
    other = tmp_path / "elsewhere" / EXE
    assert is_orphan(FakeProc(mine, None), root)  # type: ignore[arg-type]
    assert not is_orphan(FakeProc(mine, FakeParent(4242)), root)  # type: ignore[arg-type]  # owner alive
    assert not is_orphan(FakeProc(other, None), root)  # type: ignore[arg-type]  # not ours
    assert not is_orphan(FakeProc(mine, None, name="python"), root)  # type: ignore[arg-type]


@pytest.mark.skipif(sys.platform == "win32", reason="re-parenting to init is POSIX")
def test_posix_orphan_is_reparented_to_init(tmp_path: Path) -> None:
    assert is_orphan(FakeProc(tmp_path / "llama" / "cpu" / EXE, FakeParent(1)), tmp_path / "llama")  # type: ignore[arg-type]


def test_kill_orphans_kills_only_orphans(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "llama"
    orphan = FakeProc(root / "cpu" / EXE, None)
    owned = FakeProc(root / "cpu" / EXE, FakeParent(4242))
    monkeypatch.setattr(psutil, "wait_procs", lambda procs, timeout: (procs, []))
    assert kill_orphans(root, [orphan, owned]) == 1  # type: ignore[list-item]
    assert orphan.killed and not owned.killed


@pytest.mark.skipif(sys.platform != "win32", reason="real orphan: Windows (no re-parenting)")
def test_ac_09_real_orphan_left_by_a_crash_is_killed(tmp_path: Path) -> None:
    """An engine whose parent died without cleaning up, then a backend start."""
    root = tmp_path / "llama"
    (root / "cpu").mkdir(parents=True)
    exe = root / "cpu" / EXE
    # Stand-in engine: a copy of the Python base interpreter under the engine's name.
    base = Path(sys.base_prefix) / "python.exe"
    for dll in Path(sys.base_prefix).glob("*.dll"):
        (root / "cpu" / dll.name).write_bytes(dll.read_bytes())
    exe.write_bytes(base.read_bytes())
    # The "crashed backend" starts the engine and dies at once, leaving it behind.
    launcher = subprocess.run(  # noqa: S603 - test helper
        [
            sys.executable,
            "-c",
            "import os, subprocess, sys; "
            f"p = subprocess.Popen([r'{exe}', '-c', 'import time; time.sleep(120)'], "
            f"env={{**os.environ, 'PYTHONHOME': r'{sys.base_prefix}'}}, "
            "creationflags=subprocess.DETACHED_PROCESS); "
            "print(p.pid)",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    pid = int(launcher.stdout.strip())
    orphan = psutil.Process(pid)
    try:
        assert orphan.is_running()
        assert kill_orphans(root) == 1
        deadline = time.monotonic() + 10
        while orphan.is_running() and time.monotonic() < deadline:
            time.sleep(0.1)
        assert not orphan.is_running()
    finally:
        if orphan.is_running():
            orphan.kill()
