"""Engine launcher against the Process and IPC Contract v1 (IPC-30 to IPC-32, IPC-50)."""

import subprocess
import sys
import time
from pathlib import Path

import pytest

from aios_backend.engine.job import KillOnCloseJob
from aios_backend.engine.launcher import FIXED_FLAGS, find_model, minimal_env


def test_ipc_31_fixed_flags_are_exactly_the_contract_set() -> None:
    assert FIXED_FLAGS == (
        "--host",
        "127.0.0.1",
        "--api-key-stdin",
        "--offline",
        "--no-webui",
        "--no-slots",
        "--no-ui-mcp-proxy",
    )
    forbidden = {
        "--api-key",
        "--api-key-file",
        "--tools",
        "--agent",
        "--connect",
        "--path",
        "--props",
    }
    assert not forbidden & set(FIXED_FLAGS)


def test_ipc_32_environment_is_built_from_scratch(tmp_path: Path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("LLAMA_ARG_TOOLS", "all")
    monkeypatch.setenv("APPDATA", str(tmp_path / "roaming"))
    monkeypatch.setenv("PROGRAMDATA", str(tmp_path / "programdata"))
    env = minimal_env(tmp_path / "engine", tmp_path / "tmp")
    expected = (
        {"SystemRoot", "PATH", "TEMP", "TMP"}
        if sys.platform == "win32"
        else {"PATH", "HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "TMPDIR"}
    )
    assert set(env) == expected
    assert str(tmp_path / "engine") in env["PATH"]


def test_find_model_picks_the_first_gguf(tmp_path: Path) -> None:
    assert find_model(tmp_path / "missing") is None
    assert find_model(tmp_path) is None
    (tmp_path / "b.gguf").write_bytes(b"")
    (tmp_path / "a.gguf").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("x")
    assert find_model(tmp_path) == tmp_path / "a.gguf"


@pytest.mark.skipif(sys.platform != "win32", reason="Job Objects are Windows only")
def test_ipc_50_closing_the_job_kills_its_processes() -> None:
    job = KillOnCloseJob()
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    try:
        job.assign(child)
        job.close()
        deadline = time.monotonic() + 10
        while child.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        assert child.poll() is not None, "child survived the job handle being closed"
    finally:
        if child.poll() is None:
            child.kill()
