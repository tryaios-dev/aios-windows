"""IPC-12 to IPC-16, IPC-40, IPC-41, IPC-21: the writer as a real process."""

import json
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import psutil
import pytest

TOKEN = "cd" * 32


def _start(data_dir: Path, frame: bytes) -> subprocess.Popen[bytes]:
    proc = subprocess.Popen(  # noqa: S603 - our own module, no shell
        [
            sys.executable,
            "-m",
            "aios_evidence_writer",
            "--profile",
            "dev",
            "--data-dir",
            str(data_dir),
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin is not None
    proc.stdin.write(frame)
    proc.stdin.close()
    return proc


def _ready_port(proc: subprocess.Popen[bytes]) -> int:
    assert proc.stdout is not None
    line = proc.stdout.readline().decode()
    assert line.startswith("READY "), line
    return int(json.loads(line[6:])["api_port"])


@pytest.fixture
def writer(tmp_path: Path) -> Iterator[tuple[subprocess.Popen[bytes], int]]:
    proc = _start(tmp_path, json.dumps({"token": TOKEN, "api_port": 0}).encode() + b"\n")
    port = _ready_port(proc)
    yield proc, port
    proc.kill()
    proc.wait(10)


def _family(pid: int) -> list[psutil.Process]:
    """The venv launcher on Windows runs the interpreter as a child; check both."""
    root = psutil.Process(pid)
    return [root, *root.children(recursive=True)]


def _get(port: int, path: str, token: str | None) -> int:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")  # noqa: S310 - loopback
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:  # noqa: S310
            return int(r.status)
    except urllib.error.HTTPError as exc:
        return exc.code


def test_ipc_40_ready_line_and_derived_token(writer: tuple[subprocess.Popen[bytes], int]) -> None:
    _, port = writer
    assert _get(port, "/status", TOKEN) == 200
    assert _get(port, "/status", None) == 401
    assert _get(port, "/status", "ef" * 32) == 401


def test_ipc_21_listens_on_loopback_only(writer: tuple[subprocess.Popen[bytes], int]) -> None:
    proc, port = writer
    pids = {p.pid for p in _family(proc.pid)}
    conns = [
        c  # a listening socket has no remote end (psutil may report its status as NONE)
        for c in psutil.net_connections(kind="tcp")
        if c.pid in pids and c.laddr and not c.raddr
    ]
    assert conns and all(c.laddr.ip == "127.0.0.1" for c in conns)
    assert port in {c.laddr.port for c in conns}


def test_ipc_11_token_not_in_command_line_or_environment(
    writer: tuple[subprocess.Popen[bytes], int],
) -> None:
    proc, _ = writer
    for p in _family(proc.pid):
        assert TOKEN not in " ".join(p.cmdline())
        assert all(TOKEN not in v for v in p.environ().values())


def test_ipc_13_bad_handshake_exits_2_without_ready(tmp_path: Path) -> None:
    proc = _start(tmp_path, b'{"token": "short"}\n')
    out, err = proc.communicate(timeout=30)
    assert proc.returncode == 2
    assert b"READY" not in out
    assert b"handshake rejected" in err and b"short" not in err
    assert not (tmp_path / "evidence.db").exists()


def test_ac_14_second_writer_on_the_same_file_exits(
    writer: tuple[subprocess.Popen[bytes], int], tmp_path: Path
) -> None:
    second = _start(tmp_path, json.dumps({"token": TOKEN}).encode() + b"\n")
    out, err = second.communicate(timeout=30)
    assert second.returncode == 3
    assert b"READY" not in out
