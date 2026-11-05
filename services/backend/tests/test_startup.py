"""Start-up order of backend.exe (Process and IPC Contract v1, sections 4 and 8)."""

import asyncio
import json
import os
import socket
import subprocess
import sys
import threading
from pathlib import Path

import httpx
from tests.conftest import LAUNCH_TOKEN

from aios_backend.__main__ import EXIT_BAD_HANDSHAKE, serve
from aios_backend.config import Settings
from db.session import Database


def test_ready_is_announced_only_once_requests_are_served(settings: Settings, db: Database) -> None:
    ports: list[int] = []
    announced = threading.Event()

    def on_ready(port: int) -> None:  # called where READY would be printed
        ports.append(port)
        announced.set()

    loop = asyncio.new_event_loop()

    def run() -> None:
        try:
            loop.run_until_complete(serve(settings, db, 0, on_ready))
        except asyncio.CancelledError:
            pass  # how the test stops the server

    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    try:
        assert announced.wait(15), "READY never announced"
        assert ports[0] > 0  # port 0 -> OS-assigned port
        # The very first request after READY is answered: no retry loop needed in Electron.
        resp = httpx.get(
            f"http://127.0.0.1:{ports[0]}/health",
            headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"},
            timeout=5,
        )
        assert resp.status_code == 200
    finally:
        for task in asyncio.all_tasks(loop):
            loop.call_soon_threadsafe(task.cancel)
        thread.join(10)


def test_ac_10_api_is_reachable_on_loopback_only() -> None:
    from aios_backend.__main__ import bind_loopback

    sock = bind_loopback(0)
    try:
        assert sock.getsockname()[0] == "127.0.0.1"
    finally:
        sock.close()


def test_bad_handshake_exits_2_before_opening_any_database(tmp_path: Path) -> None:
    env = {**os.environ, "LOCALAPPDATA": str(tmp_path)}  # where the desktop profile would write
    result = subprocess.run(
        [sys.executable, "-m", "aios_backend"],
        input=b'{"token": "too-short"}\n',
        capture_output=True,
        env=env,
        timeout=60,
        cwd=Path(__file__).resolve().parents[1],
    )
    assert result.returncode == EXIT_BAD_HANDSHAKE
    assert b"READY" not in result.stdout
    assert b"too-short" not in result.stderr  # the frame is never echoed
    assert not list(tmp_path.rglob("*.db"))


def test_port_taken_by_another_socket_is_not_shared() -> None:
    from aios_backend.__main__ import bind_loopback

    first = bind_loopback(0)
    try:
        port = first.getsockname()[1]
        second = socket.socket()
        try:
            try:
                second.bind(("127.0.0.1", port))
                bound = True
            except OSError:
                bound = False
            assert not bound
        finally:
            second.close()
    finally:
        first.close()


def test_ready_line_matches_the_canonical_golden_vector(capsys) -> None:  # type: ignore[no-untyped-def]
    from aios_backend.__main__ import print_ready

    vectors = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "contracts/process-ipc/v1/golden-vectors/ready-lines.json"
        ).read_text("utf-8")
    )["vectors"]
    canonical = next(v for v in vectors if v.get("canonical"))
    print_ready(canonical["api_port"])
    assert capsys.readouterr().out == canonical["line"] + "\n"


def test_ipc_51_backend_exits_when_its_parent_is_gone(settings: Settings, db: Database) -> None:
    """A crashed Electron main cannot leave the backend (and so the engine) running."""
    import psutil

    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
    ready = threading.Event()

    async def main() -> None:
        task = asyncio.create_task(
            serve(settings, db, 0, lambda port: ready.set(), parent=psutil.Process(parent.pid))
        )
        while not ready.is_set():
            await asyncio.sleep(0.01)
        parent.kill()  # Electron main crashes
        parent.wait()  # reaped (here it is our child; a dead Electron is not a zombie of ours)
        await asyncio.wait_for(task, timeout=15)  # serve() returns: the backend exits

    try:
        asyncio.run(main())
    finally:
        if parent.poll() is None:
            parent.kill()
    assert ready.is_set()
