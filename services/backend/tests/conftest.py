import dataclasses
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.config import Profile, Settings, load
from aios_backend.main import create_app
from aios_common.handshake import set_token_for_tests
from db import migrate
from db.session import Database

LAUNCH_TOKEN = "test-launch-token"
LOOPBACK = ("127.0.0.1", 50000)

set_token_for_tests(LAUNCH_TOKEN)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Shipped-app behaviour (token everywhere, no docs) on a throw-away test database."""
    return dataclasses.replace(
        load(Profile.TEST),
        chats_db=tmp_path / "chats.db",
        backups_dir=tmp_path / "backups",
        recovery_pkg=tmp_path / "recovery.pkg",
        models_dir=tmp_path / "models",
    )


@pytest.fixture
def db(settings: Settings) -> Iterator[Database]:
    database = Database(settings)
    migrate.upgrade(database)
    yield database
    database.dispose()


@pytest.fixture
def client(settings: Settings, db: Database) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db), client=LOOPBACK, headers=headers) as c:
        yield c


@pytest.fixture
def anonymous(settings: Settings, db: Database) -> TestClient:
    return TestClient(create_app(settings, db), client=LOOPBACK)


class FakeAnswers:
    """Stands in for providers -> gateway -> engine. ``fail_after`` cuts an answer short."""

    def __init__(self, text: str = "A local answer.", context_length: int = 4096) -> None:
        self.text = text
        self.context_length = context_length
        self.fail_after: int | None = None
        self.calls: list[dict[str, Any]] = []

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        return ModelInfo(
            model_id=model_id or "qwen3-8b-q4km", context_length=self.context_length, runtime="fake"
        )

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        self.calls.append({"provider": provider, "model_id": model_id, "messages": messages})
        for i, word in enumerate(self.text.split(" ")):
            if self.fail_after is not None and i >= self.fail_after:
                raise ConnectionError("dropped")
            yield word if i == 0 else " " + word


@pytest.fixture
def answers() -> FakeAnswers:
    return FakeAnswers()


@pytest.fixture
def chat(settings: Settings, db: Database, answers: FakeAnswers) -> Iterator[TestClient]:
    """A client whose backend has a (fake) model to answer with."""
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    app = create_app(settings, db, answers)
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        yield c
