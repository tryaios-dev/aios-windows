"""SPIKE-D04: one local answer through the backend, with the real engine build.

Skipped unless AIOS_LLAMA_SERVER (path to a built llama-server) and AIOS_TEST_MODEL (a small
GGUF) are set, as in the CI engine jobs.
"""

import dataclasses
import json
import os
import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

SERVER = os.environ.get("AIOS_LLAMA_SERVER")
MODEL = os.environ.get("AIOS_TEST_MODEL")
needs_engine = pytest.mark.skipif(
    not (SERVER and MODEL), reason="set AIOS_LLAMA_SERVER and AIOS_TEST_MODEL"
)
PROMPT = {"messages": [{"role": "user", "content": "Once upon a time"}], "max_tokens": 16}


@pytest.fixture
def spike_client(settings: Settings, db: Database, tmp_path: Path) -> Iterator[TestClient]:
    models = tmp_path / "models"
    models.mkdir()
    if MODEL:
        shutil.copy(MODEL, models / "test.gguf")
    engine_dir = Path(SERVER).parent if SERVER else tmp_path / "no-engine"
    s = dataclasses.replace(settings, engine_dir=engine_dir, models_dir=models)
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(s, db), client=LOOPBACK, headers=headers) as c:
        yield c


def test_no_model_is_409(settings: Settings, db: Database, tmp_path: Path) -> None:
    s = dataclasses.replace(settings, models_dir=tmp_path / "empty")
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(s, db), client=LOOPBACK, headers=headers) as c:
        resp = c.post("/spike/v1/chat/completions", json=PROMPT)
    assert resp.status_code == 409
    assert resp.json() == {"error": "no_model"}


def test_spike_needs_the_launch_token(anonymous: TestClient) -> None:
    assert anonymous.post("/spike/v1/chat/completions", json=PROMPT).status_code == 401


@needs_engine
def test_streams_one_local_answer_in_openai_chunks(spike_client: TestClient) -> None:
    text = ""
    chunks = 0
    with spike_client.stream("POST", "/spike/v1/chat/completions", json=PROMPT) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        for line in resp.iter_lines():
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            assert chunk["object"] == "chat.completion.chunk"
            chunks += 1
            for choice in chunk.get("choices", []):
                text += choice.get("delta", {}).get("content") or ""
    assert chunks > 1 and text.strip()
    assert spike_client.get("/health").json()["engine"] == "ok"


@needs_engine
@pytest.mark.skipif(not Path("/proc").exists(), reason="process inspection via /proc")
def test_ipc_30_engine_key_not_in_its_command_line_or_environment(spike_client: TestClient) -> None:
    with spike_client.stream("POST", "/spike/v1/chat/completions", json=PROMPT) as resp:
        for _ in resp.iter_lines():
            pass
    engine = spike_client.app.state.engine._engine  # type: ignore[attr-defined]
    for name in ("cmdline", "environ"):
        data = Path(f"/proc/{engine.process.pid}/{name}").read_bytes()
        assert engine.key.encode() not in data
        assert LAUNCH_TOKEN.encode() not in data
    assert b"LLAMA" not in Path(f"/proc/{engine.process.pid}/environ").read_bytes()


@needs_engine
def test_engine_stops_with_the_backend(settings: Settings, db: Database, tmp_path: Path) -> None:
    models = tmp_path / "models"
    models.mkdir()
    shutil.copy(str(MODEL), models / "test.gguf")
    s = dataclasses.replace(settings, engine_dir=Path(str(SERVER)).parent, models_dir=models)
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(s, db), client=LOOPBACK, headers=headers) as c:
        with c.stream("POST", "/spike/v1/chat/completions", json=PROMPT) as resp:
            for _ in resp.iter_lines():
                pass
        proc = c.app.state.engine._engine.process  # type: ignore[attr-defined]
    assert proc.wait(15) is not None
