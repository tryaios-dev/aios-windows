"""M-03: the chat flow with a real model. The backend as backend.exe runs it (local answers,
the process manager, the real llama-server) answers a question, and the stored answer, its
evidence and the engine's own token counts are checked.

Skipped unless AIOS_LLAMA_SERVER (a built llama-server inside a ``cpu`` folder) and
AIOS_TEST_MODEL (a small GGUF) are set, as in the CI engine jobs.
"""

import dataclasses
import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_setup import first_run

from aios_backend.apps.models.models import InstalledModel
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.base import utcnow
from db.session import Database

SERVER = os.environ.get("AIOS_LLAMA_SERVER")
MODEL = os.environ.get("AIOS_TEST_MODEL")
pytestmark = pytest.mark.skipif(
    not (SERVER and MODEL), reason="set AIOS_LLAMA_SERVER and AIOS_TEST_MODEL"
)


@pytest.fixture
def real(settings: Settings, db: Database, tmp_path: Path) -> Iterator[TestClient]:
    s = dataclasses.replace(
        settings, engine_root=Path(str(SERVER)).parent.parent, models_dir=tmp_path / "models"
    )
    with db.session() as session:
        session.add(
            InstalledModel(
                id="test-model",
                name="Test model",
                tier="small",
                file_path=str(MODEL),
                artifact_digest="0" * 64,
                size_bytes=Path(str(MODEL)).stat().st_size,
                context_length=2048,
                licence="Apache-2.0",
                source="offline",
                installed_at=utcnow(),
            )
        )
        session.commit()
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(s, db, local=True), client=LOOPBACK, headers=headers) as c:
        yield c


def _conversation(c: TestClient) -> str:
    first_run(c)
    project = c.post("/projects", json={"name": "Real", "classification": "internal"}).json()
    return str(c.post(f"/projects/{project['id']}/conversations", json={}).json()["id"])


def test_m03_a_real_model_answers_and_the_answer_is_recorded(real: TestClient) -> None:
    conv = _conversation(real)
    resp = real.post(f"/conversations/{conv}/messages", json={"text": "Say hello in one word."})
    assert resp.status_code in (200, 201), resp.text
    answer = resp.json()["assistant"]
    assert answer["status"] == "complete" and answer["content"].strip()
    assert answer["model_id"] == "test-model"
    assert answer["prompt_tokens"] > 0 and answer["completion_tokens"] > 0
    event = [e for e in real.get("/evidence").json() if e["event_type"] == "inference_completed"][
        -1
    ]
    assert event["payload"]["tokens_in"] == answer["prompt_tokens"]
    assert event["payload"]["provider"] == "local"


def test_m03_a_real_model_streams_its_answer(real: TestClient) -> None:
    conv = _conversation(real)
    with real.stream(
        "POST", f"/conversations/{conv}/messages/stream", json={"text": "Count to three."}
    ) as resp:
        assert resp.status_code == 200
        events = [line[6:].strip() for line in resp.iter_lines() if line.startswith("event:")]
    assert events[0] == "started" and events[-1] == "done"
    assert "delta" in events
    stored = real.get(f"/conversations/{conv}/messages").json()
    assert stored[-1]["role"] == "assistant" and stored[-1]["content"].strip()
    assert json.dumps(stored)  # nothing unserialisable was stored
