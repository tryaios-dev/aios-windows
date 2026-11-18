"""Shared set-up for the tests that run the real llama-server.

They are skipped unless AIOS_LLAMA_SERVER (a built llama-server inside a ``cpu`` folder) and
AIOS_TEST_MODEL (a small GGUF) are set, as in the CI engine jobs. The answer goes the way chat's
does: the local model module (``aios_backend.local``) asks the process manager for the engine.
"""

import dataclasses
import os
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.apps.models.models import InstalledModel
from aios_backend.config import Settings
from aios_backend.local import LocalModels
from aios_backend.main import create_app
from db.base import utcnow
from db.session import Database

SERVER = os.environ.get("AIOS_LLAMA_SERVER")
MODEL = os.environ.get("AIOS_TEST_MODEL")
MODEL_ID = "test-model"
needs_engine = pytest.mark.skipif(
    not (SERVER and MODEL), reason="set AIOS_LLAMA_SERVER and AIOS_TEST_MODEL"
)
PROMPT = [{"role": "user", "content": "Once upon a time"}]
HEADERS = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}


def engine_root() -> Path:
    """The folder that holds ``cpu/`` (and maybe ``vulkan/``)."""
    return Path(str(SERVER)).parent.parent


def install_test_model(db: Database, path: Path | None = None, model_id: str = MODEL_ID) -> None:
    """The test model as an installed model, so the local model module answers with it."""
    file = path or Path(str(MODEL))
    with db.session() as session:
        session.add(
            InstalledModel(
                id=model_id,
                name="Test model",
                tier="small",
                file_path=str(file),
                artifact_digest="0" * 64,
                size_bytes=file.stat().st_size,
                context_length=2048,
                licence="Apache-2.0",
                source="offline",
                installed_at=utcnow(),
            )
        )
        session.commit()


def local_app(settings: Settings, db: Database, tmp_path: Path, **overrides: object) -> FastAPI:
    """backend.exe's set-up: local answers through the process manager, real engine build."""
    s = dataclasses.replace(
        settings,
        engine_root=engine_root(),
        models_dir=tmp_path / "models",
        **overrides,  # type: ignore[arg-type]
    )
    install_test_model(db)
    return create_app(s, db, local=True)


def client(app: FastAPI) -> TestClient:
    return TestClient(app, client=LOOPBACK, headers=HEADERS)


def ask(c: TestClient, chunks: int = 8) -> str:
    """A short local answer: the first ``chunks`` pieces, then the request is closed (Stop)."""
    local: LocalModels = c.app.state.answers  # type: ignore[attr-defined]
    stream = local.answer("local", MODEL_ID, PROMPT)
    text: list[str] = []
    try:
        for piece in stream:
            text.append(piece)
            if len(text) >= chunks:
                break
    finally:
        stream.close()
    return "".join(text)
