import dataclasses
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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
        load(Profile.TEST), chats_db=tmp_path / "chats.db", backups_dir=tmp_path / "backups"
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
