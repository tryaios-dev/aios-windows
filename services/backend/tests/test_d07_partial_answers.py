"""D-07 scenario 1: the backend is hard-killed mid-answer.

A kill leaves only what was committed to chats.db. The fake model below reads chats.db through
its own session partway through an answer, which is exactly what a restarted backend would
find: the question, and the answer so far (up to the last save) with status ``partial``.
"""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers
from tests.test_chat_streaming import setup_conversation

from aios_backend.apps.chat import service
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.models import Message
from db.session import Database

WORDS = 20
PEEK_AT = 10


class PeekingAnswers(FakeAnswers):
    """After ``PEEK_AT`` words, keeps what another process would read from chats.db."""

    def __init__(self, db: Database) -> None:
        super().__init__(" ".join(f"w{i}" for i in range(WORDS)))
        self.db = db
        self.seen: list[dict[str, Any]] = []

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        for i, chunk in enumerate(super().answer(provider, model_id, messages)):
            if i == PEEK_AT:
                with self.db.session() as s:
                    rows = s.scalars(select(Message).order_by(Message.position)).all()
                    self.seen = [
                        {
                            "role": m.role,
                            "content": m.content,
                            "status": m.status,
                            "versions": m.previous_versions,
                        }
                        for m in rows
                    ]
            yield chunk


@pytest.fixture
def peeking(db: Database) -> PeekingAnswers:
    return PeekingAnswers(db)


@pytest.fixture
def client(settings: Settings, db: Database, peeking: PeekingAnswers) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, peeking), client=LOOPBACK, headers=headers) as c:
        yield c


@pytest.fixture
def save_every_chunk(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service, "SAVE_EVERY_S", 0.0)


SO_FAR = "".join(f"w{i}" if i == 0 else f" w{i}" for i in range(PEEK_AT))


@pytest.mark.parametrize("path", ["messages", "messages/stream"])
def test_d07_a_kill_mid_answer_leaves_the_question_and_the_answer_so_far(
    client: TestClient, peeking: PeekingAnswers, save_every_chunk: None, path: str
) -> None:
    _, conv = setup_conversation(client)
    assert client.post(f"/conversations/{conv['id']}/{path}", json={"text": "Q"}).is_success
    assert peeking.seen == [
        {"role": "user", "content": "Q", "status": "complete", "versions": None},
        {"role": "assistant", "content": SO_FAR, "status": "partial", "versions": None},
    ]
    # The finished answer replaces the saved part.
    final = client.get(f"/conversations/{conv['id']}/messages").json()[-1]
    assert final["status"] == "complete" and final["content"] == peeking.text


@pytest.mark.parametrize("path", ["regenerate", "regenerate/stream"])
def test_d07_a_kill_mid_regenerate_keeps_the_previous_answer(
    client: TestClient, peeking: PeekingAnswers, save_every_chunk: None, path: str
) -> None:
    _, conv = setup_conversation(client)
    client.post(f"/conversations/{conv['id']}/messages", json={"text": "Q"})
    assert client.post(f"/conversations/{conv['id']}/{path}").is_success
    answer = peeking.seen[-1]
    assert answer["status"] == "partial" and answer["content"] == SO_FAR
    assert peeking.text in answer["versions"]


def test_d07_saves_are_spaced_out(
    client: TestClient, peeking: PeekingAnswers, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Not a write per word: within the save interval nothing new is written."""
    monkeypatch.setattr(service, "SAVE_EVERY_S", 3600.0)
    _, conv = setup_conversation(client)
    client.post(f"/conversations/{conv['id']}/messages", json={"text": "Q"})
    assert peeking.seen[-1]["content"] == "" and peeking.seen[-1]["status"] == "partial"
