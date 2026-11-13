"""Start and stop llama-server as the Process and IPC Contract v1 requires (IPC-30 to IPC-33).

The key is derive(T, engine), written as one line to the engine's stdin (``--api-key-stdin``,
D-03). The environment is built from scratch so no LLAMA_* variable or config.ini can change
the engine's options. Engine output is discarded: it is never logged (SR-07).

The process manager (``manager.py``) decides when to call ``start()`` and with which build.
"""

import socket
import subprocess
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from aios_backend.engine.job import ChildJob
from aios_common import platforms
from aios_common.handshake import derive
from aios_common.logging import get_logger, log_event

ENGINE_PURPOSE = "aios/ipc/v1/engine"
EXE = "llama-server" + platforms.current().exe_suffix
# IPC-31: the only flags besides model, port and sizing.
FIXED_FLAGS = (
    "--host",
    "127.0.0.1",
    "--api-key-stdin",
    "--offline",
    "--no-webui",
    "--no-slots",
    "--no-ui-mcp-proxy",
)
# Local Model Catalogue v3 sizes every model for a fixed 16k-token context with a q8_0 cache
# ("Start llama-server with a fixed context and a q8_0 cache, because the sizes assume both").
CONTEXT_TOKENS = 16384
SIZE_FLAGS = ("-ctk", "q8_0", "-ctv", "q8_0", "-fa", "on")
START_TIMEOUT_S = 180.0  # loading a 2.5 GB model from a slow disk
PROBE_TIMEOUT_S = 30.0

log = get_logger("engine")


class EngineError(Exception):
    """Start-up failed. ``str(exc)`` is a short code, never engine output."""


def find_model(models_dir: Path) -> Path | None:
    """The first .gguf in the models folder (D-04: copied there by hand)."""
    models = sorted(models_dir.glob("*.gguf")) if models_dir.is_dir() else []
    return models[0] if models else None


def minimal_env(engine_dir: Path, temp_dir: Path) -> dict[str, str]:
    """IPC-32: built from scratch. No APPDATA, PROGRAMDATA or LLAMA_* variables."""
    return platforms.current().child_env(engine_dir, temp_dir)


def list_gpus(engine_dir: Path, temp_dir: Path) -> list[str]:
    """Devices this build can offload to (``--list-devices``), e.g. ``["Vulkan0"]``.

    The CPU build lists none. Any failure counts as no GPU, so the CPU build is used. The
    output holds only device names and memory sizes and is not logged.
    """
    exe = engine_dir / EXE
    if not exe.is_file():
        return []
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        out = subprocess.run(  # noqa: S603 - fixed executable and arguments
            [str(exe), "--list-devices"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            env=minimal_env(engine_dir, temp_dir),
            cwd=temp_dir,
            timeout=PROBE_TIMEOUT_S,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if out.returncode != 0:
        return []
    return parse_device_list(out.stdout.decode("utf-8", "replace"))


def parse_device_list(text: str) -> list[str]:
    """``  Vulkan0: NVIDIA GeForce ... (8192 MiB, 7000 MiB free)`` -> ``Vulkan0``."""
    devices = []
    for line in text.splitlines():
        name, sep, _ = line.strip().partition(":")
        if sep and name and " " not in name and name != "Available devices":
            devices.append(name)
    return devices


def _free_port() -> int:
    # llama-server cannot report an OS-assigned port, so the port is picked here. Another
    # process could take it before llama-server binds; then start() fails and is retried.
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass
class Engine:
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


def _health(port: int) -> int | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as resp:  # noqa: S310
            return int(resp.status)
    except urllib.error.HTTPError as e:
        return int(e.code)
    except OSError:
        return None


def start(
    engine_dir: Path, model: Path, temp_dir: Path, job: ChildJob, build: str = "cpu"
) -> Engine:
    """Start the engine and wait until it answers. ``-ngl`` is left at llama.cpp's default
    (``auto`` with ``--fit on``): on a GPU build it offloads as many layers as fit in VRAM."""
    exe = engine_dir / EXE
    if not exe.is_file():
        raise EngineError("engine_missing")
    temp_dir.mkdir(parents=True, exist_ok=True)
    key = derive(ENGINE_PURPOSE)
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
                "-c",
                str(CONTEXT_TOKENS),
                *SIZE_FLAGS,
                *FIXED_FLAGS,
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=minimal_env(engine_dir, temp_dir),
            cwd=temp_dir,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        job.assign(proc)
        assert proc.stdin is not None
        proc.stdin.write(key.encode("ascii") + b"\n")
        proc.stdin.close()

        engine = Engine(proc, port, key, model, build)
        while time.monotonic() - began < START_TIMEOUT_S:
            if not engine.alive():
                break  # e.g. port taken in between: try another one
            if _health(port) == 200:
                log_event(
                    log,
                    "engine_started",
                    port=port,
                    component=build,
                    duration_ms=round((time.monotonic() - began) * 1000),
                )
                return engine
            time.sleep(0.25)
        else:
            engine.stop()
            raise EngineError("engine_start_timeout")
        log_event(log, "engine_exited_on_start", error_code=str(proc.returncode), status=attempt)
    raise EngineError("engine_exit_on_start")
