"""Start evidence-writer.exe (IPC-40, IPC-50, IPC-53).

The backend writes one handshake frame to the writer's stdin with ``derive(T, evidence-writer)``
and reads its READY line. The token never appears in argv or the environment; the only arguments
are the data folder (a path) and, from source, the development profile. The writer is assigned to
the backend's kill-on-close job, so it dies with the backend however the backend ends.
"""

import json
import subprocess
import sys
import threading
from dataclasses import dataclass
from pathlib import Path

from aios_backend.config import Profile, Settings
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
