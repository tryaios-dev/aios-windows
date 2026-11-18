"""Start whisper-server and turn one phrase into text (ADR 0016; contract IPC-35 to IPC-38).

The key is derive(T, voice), written as one line to whisper-server's stdin (``--api-key-stdin``,
build/whisper/patches). Every route of the patched server needs it, /health included. The
environment is built from scratch, as for the chat engine. Output is discarded: it is never
logged (SR-07), and the server is never started with a flag that prints the text.
"""

import os
import socket
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

from aios_backend.engine.job import ChildJob
from aios_common import platforms
from aios_common.handshake import derive
from aios_common.logging import get_logger, log_event

VOICE_PURPOSE = "aios/ipc/v1/voice"
EXE = "whisper-server" + platforms.current().exe_suffix
# IPC-36: the only flags besides model, port and threads. "-l auto": the text stays in the
# language that was spoken (ADR 0016); upstream's default is English.
FIXED_FLAGS = ("--host", "127.0.0.1", "--api-key-stdin", "-l", "auto", "-nt")
START_TIMEOUT_S = 60.0  # a 190 MB model
TRANSCRIBE_TIMEOUT_S = 120.0

log = get_logger("voice")


class VoiceError(Exception):
    """Start-up or transcription failed. ``str(exc)`` is a short code, never server output."""


def threads() -> int:
    """All cores up to 8: the spike's 4-core machine used 4."""
    return max(1, min(8, os.cpu_count() or 4))


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass
class Whisper:
    process: "subprocess.Popen[bytes]"
    port: int
    key: str
    model: Path
    build: str = "cpu"

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        if self.alive():
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def health(self) -> int | None:
        try:
            r = httpx.get(f"{self.base_url}/health", headers=self._auth(), timeout=2.0)
            return r.status_code
        except httpx.HTTPError:
            return None

    def transcribe(self, wav: bytes, audio_ctx: int) -> str:
        """The text of one phrase. ``audio_ctx`` fits Whisper's 30 s window to the audio (the
        spike's ``-ac``): about twice as fast on short phrases, same text."""
        try:
            r = httpx.post(
                f"{self.base_url}/inference",
                headers=self._auth(),
                files={"file": ("phrase.wav", wav, "audio/wav")},
                data={
                    "response_format": "json",
                    "temperature": "0.0",
                    "audio_ctx": str(audio_ctx),
                    "no_timestamps": "true",
                },
                timeout=TRANSCRIBE_TIMEOUT_S,
            )
        except httpx.HTTPError as exc:
            raise VoiceError("voice_unreachable") from exc
        if r.status_code != 200:
            raise VoiceError(f"voice_http_{r.status_code}")
        text = r.json().get("text")
        return text if isinstance(text, str) else ""

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}"}


def start(
    voice_dir: Path, model: Path, temp_dir: Path, job: ChildJob, build: str = "cpu"
) -> Whisper:
    """Start whisper-server and wait until it answers /health with the key."""
    exe = voice_dir / EXE
    if not exe.is_file():
        raise VoiceError("voice_not_built")
    temp_dir.mkdir(parents=True, exist_ok=True)
    key = derive(VOICE_PURPOSE)
    for attempt in range(3):
        port = _free_port()
        began = time.monotonic()
        proc = subprocess.Popen(  # noqa: S603 - fixed executable and arguments
            [
                str(exe),
                "-m",
                str(model),
                "--port",
                str(port),
                "-t",
                str(threads()),
                *FIXED_FLAGS,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=platforms.current().child_env(voice_dir, temp_dir),
            cwd=temp_dir,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        job.assign(proc)
        assert proc.stdin is not None
        proc.stdin.write(key.encode("ascii") + b"\n")
        proc.stdin.close()

        whisper = Whisper(proc, port, key, model, build)
        while time.monotonic() - began < START_TIMEOUT_S:
            if not whisper.alive():
                break  # e.g. port taken in between: try another one
            if whisper.health() == 200:
                log_event(
                    log,
                    "voice_started",
                    port=port,
                    component=build,
                    duration_ms=round((time.monotonic() - began) * 1000),
                )
                return whisper
            time.sleep(0.1)
        else:
            whisper.stop()
            raise VoiceError("voice_start_timeout")
        log_event(log, "voice_exited_on_start", error_code=str(proc.returncode), status=attempt)
    raise VoiceError("voice_exit_on_start")
