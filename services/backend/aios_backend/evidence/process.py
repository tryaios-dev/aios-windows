"""Start evidence-writer.exe (IPC-40, IPC-50, IPC-53).

The backend writes one handshake frame to the writer's stdin with ``derive(T, evidence-writer)``
and reads its READY line. The token never appears in argv or the environment; the only arguments
are the data folder (a path) and, from source, the development profile. The writer is assigned to
the backend's kill-on-close job, so it dies with the backend however the backend ends.

Before starting, ``start`` reads the writer's record (D-07, ``leftover``): a writer in use by a
running backend means ``writer_locked`` at once; one left behind by a crashed backend is ended
first. If the new writer still finds the file held (exit code 3), the leftover check runs once
more and the start is tried again.
"""

import json
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from aios_backend.config import Profile, Settings
from aios_backend.evidence.client import (
    WRITER_PURPOSE,
    HttpWriterClient,
    WriterClient,
    WriterUnavailable,
)
from aios_backend.evidence import leftover
from aios_backend.evidence.client import WRITER_PURPOSE, HttpWriterClient
from aios_common import platforms
from aios_common.handshake import derive
from aios_common.logging import get_logger, log_event
from aios_common.platforms import ChildJob

EXE = "evidence-writer" + platforms.current().exe_suffix
START_TIMEOUT_S = 30.0

log = get_logger("evidence")


class WriterStartError(Exception):
    """The writer did not start. ``str(exc)`` is a short code."""


@dataclass
class WriterProcess:
    process: "subprocess.Popen[bytes]"
    port: int
    client: HttpWriterClient

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()


def command(settings: Settings) -> tuple[list[str], dict[str, str] | None]:
    """Installed: resources/evidence-writer/evidence-writer.exe next to resources/backend/.
    From source: the module, with the development seed outside the desktop profile."""
    data_dir = str(settings.chats_db.parent)
    logs = ["--log-dir", str(settings.log_file.parent)] if settings.log_file else []
    if getattr(sys, "frozen", False):
        exe = Path(sys.executable).resolve().parents[1] / "evidence-writer" / EXE
        if not exe.is_file():
            raise WriterStartError("writer_missing")
        temp = settings.chats_db.parent.parent / "writer-tmp"
        temp.mkdir(parents=True, exist_ok=True)
        return [str(exe), "--data-dir", data_dir, *logs], platforms.current().child_env(
            exe.parent, temp
        )
    profile = "desktop" if settings.profile is Profile.DESKTOP else "dev"
    return [
        sys.executable,
        "-m",
        "aios_evidence_writer",
        "--profile",
        profile,
        "--data-dir",
        data_dir,
        *logs,
    ], None


def start(settings: Settings, job: ChildJob) -> WriterProcess:
    folder = settings.chats_db.parent
    if leftover.in_use(folder):
        log_event(log, "writer_start_failed", error_code="writer_locked")
        raise WriterStartError("writer_locked")
    leftover.end_leftover_writer(folder)
    try:
        return _start_once(settings, job)
    except WriterStartError as exc:
        if str(exc) != "writer_locked" or not leftover.end_leftover_writer(folder):
            raise
    return _start_once(settings, job)


def _start_once(settings: Settings, job: ChildJob) -> WriterProcess:
    argv, env = command(settings)
    token = derive(WRITER_PURPOSE)
    proc = subprocess.Popen(  # noqa: S603 - fixed program and arguments, no shell
        argv,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,  # never logged (SR-07)
        env=env,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    job.assign(proc)
    assert proc.stdin is not None and proc.stdout is not None
    proc.stdin.write(json.dumps({"token": token, "api_port": 0}).encode() + b"\n")
    proc.stdin.close()  # IPC-53

    port: list[int] = []

    def read_ready() -> None:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.decode("utf-8", "replace")
            if line.startswith("READY "):
                try:
                    port.append(int(json.loads(line[6:])["api_port"]))
                except (ValueError, KeyError, TypeError):
                    continue
                return

    reader = threading.Thread(target=read_ready, daemon=True)
    reader.start()
    reader.join(START_TIMEOUT_S)
    if not port:
        exit_code = proc.poll()
        if exit_code is None:
            proc.kill()
        code = "writer_locked" if exit_code == 3 else "writer_start_timeout"
        log_event(log, "writer_start_failed", error_code=code)
        raise WriterStartError(code)
    log_event(log, "writer_started", port=port[0])
    return WriterProcess(proc, port[0], HttpWriterClient.connect(port[0], token))


# Crash recovery: restarts allowed within RESTART_WINDOW_S before the writer is left down.
MAX_RESTARTS = 3
RESTART_WINDOW_S = 300.0


class SupervisedWriter:
    """The writer's API, starting the writer again when it has exited (crash recovery).

    A crashed writer is noticed on the next call (the pump calls every few seconds) and started
    again with the same derived token on a new port. Events wait in the outbox meanwhile and are
    replayed in order (F-05), so nothing is lost. A writer that keeps exiting is left down after
    MAX_RESTARTS within RESTART_WINDOW_S: calls then raise ``WriterUnavailable`` and Health shows
    the writer as unavailable, as before.
    """

    def __init__(
        self,
        start_writer: Callable[[], WriterProcess],
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._start = start_writer
        self._now = now
        self._lock = threading.Lock()
        self._restarts: list[float] = []
        self._proc = start_writer()

    def stop(self) -> None:
        with self._lock:
            self._proc.stop()

    def _client(self) -> WriterClient:
        with self._lock:
            exit_code = self._proc.process.poll()
            if exit_code is None:
                return self._proc.client
            at = self._now()
            self._restarts = [t for t in self._restarts if at - t < RESTART_WINDOW_S]
            if len(self._restarts) >= MAX_RESTARTS:
                raise WriterUnavailable("writer_unavailable")
            self._restarts.append(at)
            log_event(log, "writer_exited", error_code=f"exit_{exit_code}")
            try:
                self._proc = self._start()
            except WriterStartError as exc:
                raise WriterUnavailable("writer_unavailable") from exc
            log_event(log, "writer_restarted")
            return self._proc.client

    def status(self) -> dict[str, Any]:
        return self._client().status()

    def init_stream(self, stream_id: str) -> dict[str, Any]:
        return self._client().init_stream(stream_id)

    def append(self, intents: list[dict[str, Any]]) -> dict[str, Any]:
        return self._client().append(intents)

    def checkpoint(self) -> dict[str, Any]:
        return self._client().checkpoint()

    def checkpoints(self, from_seq: int | None = None) -> list[dict[str, Any]]:
        return self._client().checkpoints(from_seq)

    def events(self, after_seq: int | None = None) -> list[dict[str, Any]]:
        return self._client().events(after_seq)

    def export(self, scope: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
        return self._client().export(scope)

    def backup(self, path: str) -> None:
        self._client().backup(path)

    def restore(self, backup_path: str, stream_id: str, min_tip_seq: int | None) -> dict[str, Any]:
        return self._client().restore(backup_path, stream_id, min_tip_seq)
