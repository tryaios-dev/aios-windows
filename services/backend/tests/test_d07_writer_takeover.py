"""D-07 scenario 2: the backend crashed and its evidence writer is still running.

The real writer runs as a process, started by a stand-in backend that is then hard-killed. The
restarted backend must end the leftover writer and start its own: exactly one writer, and the
chain goes on with no gap. A writer whose backend still runs is never touched.
"""

import json
import sqlite3
import subprocess
import sys
import textwrap
import uuid
from collections.abc import Iterator
from pathlib import Path

import psutil
import pytest

from aios_backend.config import Settings
from aios_backend.evidence import leftover
from aios_backend.evidence import process as writer_process
from aios_backend.evidence.client import WRITER_PURPOSE, HttpWriterClient
from aios_common import pidfile
from aios_common.canonical import b64url
from aios_common.handshake import derive
from aios_common.platforms import ChildJob
from aios_evidence_writer import chain
from aios_evidence_writer.keys import DEV_SEED
from aios_evidence_writer.store import check_chain

STREAM = str(uuid.uuid4())
TIME = "2026-11-16T10:00:00.000Z"

# Reads the writer's argv and the handshake frame from stdin, starts the writer, passes its
# READY line on, then waits to be killed (a backend that crashes).
STAND_IN = textwrap.dedent(
    """
    import json, subprocess, sys, time
    argv = json.loads(sys.stdin.readline())
    frame = sys.stdin.readline().encode()
    w = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL)
    w.stdin.write(frame)
    w.stdin.close()
    sys.stdout.write(w.stdout.readline().decode())
    sys.stdout.flush()
    time.sleep(600)
    """
)


def _folder(settings: Settings) -> Path:
    return settings.chats_db.parent


def _record(settings: Settings) -> Path:
    return _folder(settings) / pidfile.WRITER_PID_FILE


def _frame() -> str:
    return json.dumps({"token": derive(WRITER_PURPOSE), "api_port": 0}) + "\n"


def _intent(n: int) -> dict[str, object]:
    if n == 0:
        public = chain.public_key(DEV_SEED)
        body: dict[str, object] = {
            "signing_key": b64url(public),
            "key_id": chain.key_id(public),
            "app_version": "0.1.0",
        }
        return {"intent_id": "i-0", "type": "store_created", "time": TIME, "body": body}
    body = {"project_id": str(uuid.uuid4()), "classification": "restricted"}
    return {"intent_id": f"i-{n}", "type": "project_created", "time": TIME, "body": body}


def _client(port: int) -> HttpWriterClient:
    return HttpWriterClient.connect(port, derive(WRITER_PURPOSE))


def _holder(settings: Settings) -> psutil.Process:
    holder = pidfile.read(_record(settings))
    assert holder is not None
    return psutil.Process(holder.pid)


@pytest.fixture
def stand_in(settings: Settings) -> Iterator[tuple[subprocess.Popen[bytes], int]]:
    """A backend that started a writer, with one event written. Killed by the caller."""
    _folder(settings).mkdir(parents=True, exist_ok=True)
    argv, _ = writer_process.command(settings)
    proc = subprocess.Popen(  # noqa: S603 - our own interpreter and code, no shell
        [sys.executable, "-c", STAND_IN],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
    )
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write((json.dumps(argv) + "\n" + _frame()).encode())
    proc.stdin.close()
    line = proc.stdout.readline().decode()
    assert line.startswith("READY "), line
    port = int(json.loads(line[6:])["api_port"])
    old = _client(port)
    old.init_stream(STREAM)
    old.append([_intent(0), _intent(1)])
    family = [psutil.Process(proc.pid), *psutil.Process(proc.pid).children(recursive=True)]
    yield proc, port
    for p in family:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass


def _crash(backend: subprocess.Popen[bytes], writer: psutil.Process) -> None:
    """Hard-kill the stand-in backend and everything it started except the writer. From source
    on Windows the venv's python.exe is a launcher that runs the interpreter as its child, so
    there are launchers between the backend and the writer; they go too, as the installed app
    has none."""
    killed = [
        p
        for p in [
            psutil.Process(backend.pid),
            *psutil.Process(backend.pid).children(recursive=True),
        ]
        if p.pid != writer.pid
    ]
    for p in killed:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    backend.wait(10)
    # A kill is not instant on Windows: wait until every one is gone, or the writer's real
    # starter (a launcher's child) can still look alive and the new start says writer_locked.
    _, alive = psutil.wait_procs(killed, timeout=10)
    assert not alive, alive


@pytest.fixture
def no_grace(monkeypatch: pytest.MonkeyPatch) -> None:
    """End the leftover at once, while it is surely still running."""
    monkeypatch.setattr(leftover, "GRACE_S", 0.0)


def _events(settings: Settings) -> list[int]:
    conn = sqlite3.connect(_folder(settings) / "evidence.db")
    conn.row_factory = sqlite3.Row
    try:
        check_chain(conn, STREAM)  # raises chain_invalid on any gap or broken link
        return [r["seq"] for r in conn.execute("SELECT seq FROM events ORDER BY seq")]
    finally:
        conn.close()


def test_d07_a_leftover_writer_is_ended_and_a_new_one_takes_over(
    settings: Settings, stand_in: tuple[subprocess.Popen[bytes], int], no_grace: None
) -> None:
    backend, _ = stand_in
    old = _holder(settings)
    _crash(backend, old)  # its writer is still running
    assert old.is_running()

    child = writer_process.start(settings, ChildJob())
    try:
        assert not old.is_running()
        new = _holder(settings)
        assert new.pid != old.pid and new.is_running()
        child.client.append([_intent(2)])
    finally:
        child.stop()
    assert _events(settings) == [0, 1, 2]


def test_d07_the_restart_waits_for_a_writer_already_on_its_way_out(
    settings: Settings, stand_in: tuple[subprocess.Popen[bytes], int]
) -> None:
    """With the grace time a leftover writer that notices its backend is gone ends itself."""
    backend, _ = stand_in
    old = _holder(settings)
    _crash(backend, old)

    child = writer_process.start(settings, ChildJob())
    try:
        assert not old.is_running()
        child.client.append([_intent(2)])
    finally:
        child.stop()
    assert _events(settings) == [0, 1, 2]


def test_d07_a_writer_whose_backend_still_runs_is_left_alone(
    settings: Settings, stand_in: tuple[subprocess.Popen[bytes], int], no_grace: None
) -> None:
    _, port = stand_in
    old = _holder(settings)
    with pytest.raises(writer_process.WriterStartError, match="writer_locked"):
        writer_process.start(settings, ChildJob())
    assert old.is_running()
    assert _client(port).status()["tip_seq"] == 1


def test_d07_a_record_naming_another_process_is_ignored(tmp_path: Path) -> None:
    """A pid that was reused by an unrelated process is never ended."""
    me = psutil.Process()
    record = tmp_path / pidfile.WRITER_PID_FILE
    pidfile.write(record, pidfile.Holder(me.pid, me.create_time() - 100, 1, None))
    assert leftover.end_leftover_writer(tmp_path) is False
    assert me.is_running()


def test_d07_no_record_means_nothing_to_end(tmp_path: Path) -> None:
    assert leftover.end_leftover_writer(tmp_path) is False
    (tmp_path / pidfile.WRITER_PID_FILE).write_text("not json")
    assert leftover.end_leftover_writer(tmp_path) is False
