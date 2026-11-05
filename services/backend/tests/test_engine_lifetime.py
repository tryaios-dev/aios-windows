"""The process manager with the real llama-server (D-05, AC-09).

Skipped unless AIOS_LLAMA_SERVER (a built llama-server inside a ``cpu`` folder) and
AIOS_TEST_MODEL (a small GGUF) are set, as in the CI engine jobs.
"""

import dataclasses
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

SERVER = os.environ.get("AIOS_LLAMA_SERVER")
MODEL = os.environ.get("AIOS_TEST_MODEL")
pytestmark = pytest.mark.skipif(
    not (SERVER and MODEL), reason="set AIOS_LLAMA_SERVER and AIOS_TEST_MODEL"
)
PROMPT = {"messages": [{"role": "user", "content": "Once upon a time"}], "max_tokens": 8}


def _answer(c: TestClient) -> None:
    with c.stream("POST", "/spike/v1/chat/completions", json=PROMPT) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_lines())
    assert "error" not in body


def _wait_gone(pid: int, timeout: float = 15) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not psutil.pid_exists(pid) or psutil.Process(pid).status() == psutil.STATUS_ZOMBIE:
            return True
        time.sleep(0.1)
    return False


def test_idle_unload_frees_the_engine_and_the_next_message_restarts_it(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    models = tmp_path / "models"
    models.mkdir()
    shutil.copy(str(MODEL), models / "test.gguf")
    s = dataclasses.replace(
        settings,
        engine_root=Path(str(SERVER)).parent.parent,
        models_dir=models,
        engine_idle_unload_s=1.0,
    )
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(s, db), client=LOOPBACK, headers=headers) as c:
        _answer(c)
        health = c.get("/health").json()
        assert health["engine"] == "ok" and health["engine_model"] == "test.gguf"
        proc = c.app.state.engine._engine.process  # type: ignore[attr-defined]
        assert proc.stdin.closed  # IPC-53: key written, pipe closed by the parent
        pid = proc.pid

        assert _wait_gone(pid), "engine still running after the idle period"
        health = c.get("/health").json()
        assert health["engine"] == "not_started" and health["engine_idle_unloaded"]

        _answer(c)  # no user action needed: the next message restarts it
        assert c.get("/health").json()["engine"] == "ok"


HOLDER = r"""
import asyncio, sys
from pathlib import Path
from aios_backend.components import Components
from aios_backend.engine import EngineManager

async def main():
    root, models, tmp = map(Path, sys.argv[1:4])
    m = EngineManager(root, models, tmp, Components())
    engine = await m.ensure()
    print(engine.process.pid, flush=True)
    await asyncio.sleep(600)

asyncio.run(main())
"""


@pytest.mark.skipif(sys.platform != "win32", reason="Job Objects are Windows only")
def test_ac_09_no_engine_remains_after_the_backend_is_killed(tmp_path: Path) -> None:
    """TerminateProcess on the backend (Task Manager "End task"): its engine dies with it."""
    models = tmp_path / "models"
    models.mkdir()
    shutil.copy(str(MODEL), models / "test.gguf")
    backend = subprocess.Popen(  # noqa: S603 - test helper
        [
            sys.executable,
            "-c",
            HOLDER,
            str(Path(str(SERVER)).parent.parent),
            str(models),
            str(tmp_path / "engine-tmp"),
        ],
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        assert backend.stdout is not None
        engine_pid = int(backend.stdout.readline())
        assert psutil.Process(engine_pid).is_running()
        backend.kill()  # TerminateProcess: no clean-up code runs
        backend.wait()
        assert _wait_gone(engine_pid), "llama-server survived the backend"
    finally:
        if backend.poll() is None:
            backend.kill()
